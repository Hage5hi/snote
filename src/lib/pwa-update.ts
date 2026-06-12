// PWA update flow.
//
// Goals:
//   1. Users on the published site (snote.lovable.app, custom domain) ALWAYS
//      see a persistent "Update" toast as soon as a new build is live — even
//      if the service worker is slow to fire `onNeedRefresh` or the user has
//      SW disabled entirely. We do this by polling /version.json (no-store)
//      and comparing against the build ID stamped into THIS tab's bundle.
//   2. The Lovable preview iframe (id-preview--*.lovable.app) NEVER serves a
//      stale build. Iterating in the editor and seeing yesterday's UI is a
//      bug — there is no offline-install value in a preview. We unregister
//      any previously-installed SW and nuke its caches, then skip
//      re-registration entirely on those hosts.
//   3. User data (localStorage: recents, pins, theme; IndexedDB: Yjs docs;
//      Supabase session) is NEVER touched by any cache-clearing logic.
//      Only Cache Storage (workbox / SW caches) is cleared.

import { registerSW } from "virtual:pwa-register";
import { toast as sonnerToast } from "sonner";
import { detectLang, dict, STORAGE_KEY, type Lang } from "@/i18n";

// Build ID stamped at compile time. See vite.config.ts.
declare const __BUILD_ID__: string;
const CURRENT_BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

// Poll cadence for /version.json. Short enough that a user idling on the app
// during a deploy gets the update prompt within a minute, long enough that
// it's not a thundering herd on the static host.
const VERSION_POLL_INTERVAL_MS = 60 * 1000;
// Independent cadence for asking the SW to re-check itself. Same target.
const SW_UPDATE_POLL_INTERVAL_MS = 60 * 1000;
const TOAST_ID = "pwa-update-toast";

type FlatDict = Record<string, string>;

function tr(lang: Lang, key: string): string {
  const d = dict as unknown as Record<Lang, FlatDict>;
  return d[lang]?.[key] ?? d.en[key] ?? key;
}

// Preview iframe served by Lovable's editor. We don't want a SW caching
// anything here — every reload should hit the latest deployed preview build.
function isLovablePreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  return /(^|\.)id-preview--/.test(window.location.hostname);
}

// Best-effort: remove every previously-registered SW + every Cache Storage
// entry. Does NOT touch localStorage / IndexedDB — user data is sacred.
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

// /version.json poller — works even with no SW. Returns a stop fn.
function startVersionPoller(onMismatch: () => void): () => void {
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
        onMismatch();
      }
    } catch {
      /* network blip — try again next tick */
    }
  };

  // First check shortly after boot so a user who opens the app right after a
  // deploy sees the prompt quickly, not a minute later.
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
  // No SW is generated in dev builds (devOptions.enabled: false). Nothing to
  // poll either — Vite already serves fresh modules.
  if (import.meta.env.DEV) return;

  // Lovable preview iframe: unregister anything previously installed, wipe
  // caches, and bail. Future reloads will always hit the latest deploy.
  if (isLovablePreviewHost()) {
    void nukeServiceWorkersAndCaches();
    return;
  }

  let updateAvailable = false;
  let pendingReload: (() => void) | null = null;

  const triggerToast = () => {
    updateAvailable = true;
    showUpdateToast(() => {
      // If the SW has a waiting worker, prefer its proper activation path
      // (skipWaiting → controllerchange → reload). Otherwise just hard-reload
      // — the new index.html will pick up the new bundle hashes.
      if (pendingReload) {
        pendingReload();
      } else {
        window.location.reload();
      }
    });
  };

  // Always run the version poller — it's the safety net for the "SW didn't
  // fire onNeedRefresh" failure mode that originally caused stale tabs.
  startVersionPoller(triggerToast);

  if (!("serviceWorker" in navigator)) return;

  const updateSW = registerSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      pendingReload = () => {
        // updateSW(true) posts SKIP_WAITING to the waiting SW and reloads
        // once the new SW takes control. Caches are managed by Workbox
        // (`cleanupOutdatedCaches: true`), so old precache entries are
        // pruned automatically on activate. User data is untouched.
        void updateSW(true);
      };
      // Immediate check so a freshly opened tab after a deploy doesn't sit
      // on the old build for an hour.
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

  // Re-render the toast in the user's current language if they switch while
  // the update prompt is up.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && updateAvailable) triggerToast();
  });
  window.addEventListener("i18n:lang-changed", () => {
    if (updateAvailable) triggerToast();
  });
}
