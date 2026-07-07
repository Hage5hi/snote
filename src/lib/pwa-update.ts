// PWA update flow.
//
// Goals:
//   1. Users on the published site (snote.lovable.app, custom domain) ALWAYS
//      see a persistent "Update" toast as soon as a new build is live — even
//      if the service worker is slow to fire `onNeedRefresh` or the user has
//      SW disabled entirely. We do this by polling /version.json (no-store)
//      and comparing against the build ID stamped into THIS tab's bundle.
//   2. Clicking Update ALWAYS results in the tab actually running the new
//      build. Previously we only called `updateSW(true)` which is a no-op
//      when there is no *waiting* service worker (which is exactly the case
//      when the version poller fires the toast before the SW has installed
//      the new build, or when the user has SW disabled entirely). Result:
//      the toast kept re-appearing forever after the user clicked Update.
//      Now we fall back to a cache-busting hard reload in that path.
//   3. The Lovable preview iframe (id-preview--*.lovable.app) NEVER serves a
//      stale build — SW is unregistered + caches nuked; no re-registration.
//   4. User data (localStorage: recents, pins, theme; IndexedDB: Yjs docs;
//      Supabase session) is NEVER touched. Only Cache Storage is cleared.

import { registerSW } from "virtual:pwa-register";
import { toast as sonnerToast } from "sonner";
import { detectLang, dict, STORAGE_KEY, type Lang } from "@/i18n";

// Build ID stamped at compile time. See vite.config.ts.
declare const __BUILD_ID__: string;
const CURRENT_BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

const VERSION_POLL_INTERVAL_MS = 60 * 1000;
const SW_UPDATE_POLL_INTERVAL_MS = 60 * 1000;
const TOAST_ID = "pwa-update-toast";
// When the user clicks Update we remember the target buildId here. If the
// tab boots and still sees CURRENT_BUILD_ID === accepted target, that means
// the reload failed to pick up the new bundle (aggressive HTTP cache, proxy,
// etc.). We skip re-showing the toast for that build to avoid the infinite
// loop, and log a diagnostic instead.
const ACCEPTED_BUILD_KEY = "pwa-update-accepted-build";

type FlatDict = Record<string, string>;

function tr(lang: Lang, key: string): string {
  const d = dict as unknown as Record<Lang, FlatDict>;
  return d[lang]?.[key] ?? d.en[key] ?? key;
}

function isLovablePreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  return /(^|\.)id-preview--/.test(window.location.hostname);
}

async function nukeServiceWorkersAndCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
    }
  } catch {
    /* ignore */
  }
}

// Cache-busting reload: replaces the URL with a `?v=<buildId>` query so the
// browser HTTP cache can't serve the previously-cached index.html. We use
// `replace` (not `assign`) so back-button history isn't polluted with the
// versioned URL. Falls back to the current href if we don't know the target.
function hardReload(targetBuildId: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (targetBuildId) url.searchParams.set("v", targetBuildId);
    else url.searchParams.set("v", String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

function showUpdateToast(onReload: () => void): void {
  const lang = detectLang();
  sonnerToast(tr(lang, "update.title"), {
    id: TOAST_ID,
    description: tr(lang, "update.description"),
    duration: Infinity,
    action: {
      label: tr(lang, "update.btn_reload"),
      onClick: onReload,
    },
  });
}

function startVersionPoller(onMismatch: (remoteBuildId: string) => void): () => void {
  let stopped = false;
  let timer: number | undefined;

  const check = async () => {
    if (stopped) return;
    try {
      const res = await fetch(`/version.json?ts=${Date.now()}`, {
        cache: "no-store",
        credentials: "omit",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { buildId?: string };
      if (data?.buildId && data.buildId !== CURRENT_BUILD_ID) {
        console.log(
          `[pwa-update] mismatch current=${CURRENT_BUILD_ID} remote=${data.buildId}`,
        );
        onMismatch(data.buildId);
      }
    } catch {
      /* network blip — try again next tick */
    }
  };

  window.setTimeout(check, 3000);
  timer = window.setInterval(check, VERSION_POLL_INTERVAL_MS) as unknown as number;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  window.addEventListener("focus", () => void check());

  return () => {
    stopped = true;
    if (timer !== undefined) window.clearInterval(timer);
  };
}

export function registerAppUpdater(): void {
  if (typeof window === "undefined") return;
  if (import.meta.env.DEV) return;

  if (isLovablePreviewHost()) {
    void nukeServiceWorkersAndCaches();
    return;
  }

  // Break the infinite-toast loop: if a previous reload was accepted for a
  // buildId that matches THIS tab's build, the reload failed to activate the
  // new build (HTTP cache, aggressive proxy, offline SW). Don't keep asking.
  let acceptedBuild: string | null = null;
  try {
    acceptedBuild = sessionStorage.getItem(ACCEPTED_BUILD_KEY);
  } catch {
    /* ignore */
  }
  if (acceptedBuild && acceptedBuild === CURRENT_BUILD_ID) {
    console.warn(
      `[pwa-update] update was accepted for build=${acceptedBuild} but tab is still on the same build; ` +
        `suppressing toast for this session. The next deploy will trigger it again.`,
    );
  }

  let updateAvailable = false;
  let latestRemoteBuildId: string | null = null;
  let waitingRegistration: ServiceWorkerRegistration | null = null;
  let updateSWFn: ((reload?: boolean) => Promise<void>) | null = null;

  const reloadNow = () => {
    try {
      sessionStorage.setItem(ACCEPTED_BUILD_KEY, latestRemoteBuildId ?? "unknown");
    } catch {
      /* ignore */
    }

    // Prefer the proper SW activation path when a waiting worker exists —
    // it swaps controllers cleanly and Workbox prunes outdated caches.
    if (waitingRegistration?.waiting && updateSWFn) {
      console.log("[pwa-update] reload strategy=waiting-sw");
      // Safety net: some browsers don't reliably fire controllerchange after
      // skipWaiting when there are open clients. Force a hard reload after a
      // short wait so the user is never stuck.
      const fallback = window.setTimeout(() => {
        console.log("[pwa-update] waiting-sw fallback → hard reload");
        hardReload(latestRemoteBuildId);
      }, 2500);
      let done = false;
      const onCtrl = () => {
        if (done) return;
        done = true;
        window.clearTimeout(fallback);
        hardReload(latestRemoteBuildId);
      };
      navigator.serviceWorker?.addEventListener("controllerchange", onCtrl, { once: true });
      void updateSWFn(true).catch(() => {
        window.clearTimeout(fallback);
        hardReload(latestRemoteBuildId);
      });
      return;
    }

    // No waiting SW → the update came from the version poller (or SW is
    // disabled). A cache-busting hard reload is the only reliable path.
    console.log("[pwa-update] reload strategy=hard");
    hardReload(latestRemoteBuildId);
  };

  const triggerToast = () => {
    if (acceptedBuild && acceptedBuild === CURRENT_BUILD_ID) return;
    updateAvailable = true;
    showUpdateToast(reloadNow);
  };

  startVersionPoller((remoteBuildId) => {
    latestRemoteBuildId = remoteBuildId;
    triggerToast();
  });

  if (!("serviceWorker" in navigator)) return;

  updateSWFn = registerSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      waitingRegistration = registration;
      registration.update().catch(() => {});
      window.setInterval(() => {
        registration.update().catch(() => {});
      }, SW_UPDATE_POLL_INTERVAL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      });
      window.addEventListener("focus", () => {
        registration.update().catch(() => {});
      });
    },
    onNeedRefresh() {
      triggerToast();
    },
  });

  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && updateAvailable) triggerToast();
  });
  window.addEventListener("i18n:lang-changed", () => {
    if (updateAvailable) triggerToast();
  });
}
