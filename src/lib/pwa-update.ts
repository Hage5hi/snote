// PWA update flow.
//
// The toast stays visible until the tab is actually running the deployed
// buildId from /version.json. Clicking Update only marks that build as
// pending and starts one reload path; repeated clicks are ignored while that
// path is in progress.

import { createElement, type MouseEvent, type ReactNode } from "react";
import { registerSW } from "virtual:pwa-register";
import { toast as sonnerToast } from "sonner";
import { detectLang, dict, STORAGE_KEY, type Lang } from "@/i18n";

declare const __BUILD_ID__: string;
const STAMPED_BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

const VERSION_POLL_INTERVAL_MS = 60 * 1000;
const SW_UPDATE_POLL_INTERVAL_MS = 60 * 1000;
const TOAST_ID = "pwa-update-toast";
const PENDING_BUILD_KEY = "pwa-update-pending-build";

type ReloadStrategy = "waiting-sw" | "hard" | null;

type PwaUpdateDebugState = {
  currentBuildId: string;
  pendingBuildId: string | null;
  updateAvailable: boolean;
  updateInProgress: boolean;
  lastRemoteBuildId: string | null;
  reloadAttemptCount: number;
  reloadStrategy: ReloadStrategy;
  lastAcceptedAt: number | null;
};

declare global {
  interface Window {
    __SNOTE_E2E_ENABLE_PWA_UPDATE__?: boolean;
    __SNOTE_E2E_BUILD_ID__?: string;
    __SNOTE_E2E_PWA_INITIAL_POLL_MS__?: number;
    __SNOTE_E2E_PWA_POLL_INTERVAL_MS__?: number;
    __SNOTE_PWA_UPDATE_STATE__?: PwaUpdateDebugState;
  }
}

type FlatDict = Record<string, string>;

function tr(lang: Lang, key: string): string {
  const d = dict as unknown as Record<Lang, FlatDict>;
  return d[lang]?.[key] ?? d.en[key] ?? key;
}

function isLovablePreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  return /(^|\.)id-preview--/.test(window.location.hostname);
}

function isE2EUpdateEnabled(): boolean {
  return typeof window !== "undefined" && window.__SNOTE_E2E_ENABLE_PWA_UPDATE__ === true;
}

function getCurrentBuildId(): string {
  if (isE2EUpdateEnabled() && typeof window.__SNOTE_E2E_BUILD_ID__ === "string") {
    return window.__SNOTE_E2E_BUILD_ID__;
  }
  return STAMPED_BUILD_ID;
}

function writeDebugState(next: Partial<PwaUpdateDebugState>): void {
  if (typeof window === "undefined") return;
  const previous = window.__SNOTE_PWA_UPDATE_STATE__ ?? {
    currentBuildId: getCurrentBuildId(),
    pendingBuildId: null,
    updateAvailable: false,
    updateInProgress: false,
    lastRemoteBuildId: null,
    reloadAttemptCount: 0,
    reloadStrategy: null,
    lastAcceptedAt: null,
  };
  window.__SNOTE_PWA_UPDATE_STATE__ = {
    ...previous,
    ...next,
    currentBuildId: getCurrentBuildId(),
  };
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

function hardReload(targetBuildId: string | null): void {
  if (isE2EUpdateEnabled() && targetBuildId) {
    window.__SNOTE_E2E_BUILD_ID__ = targetBuildId;
    window.dispatchEvent(new CustomEvent("snote:e2e-pwa-hard-reload", { detail: { targetBuildId } }));
    return;
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("v", targetBuildId ?? String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

function updateButton(label: string, disabled: boolean, onReload: () => void): ReactNode {
  return createElement(
    "button",
    {
      type: "button",
      "data-button": true,
      "data-action": true,
      "data-disabled": disabled ? "true" : undefined,
      disabled,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        if (!disabled) onReload();
      },
    },
    disabled ? `${label}…` : label,
  );
}

function updateDescription(currentBuildId: string, pendingBuildId: string | null): ReactNode {
  const lang = detectLang();
  return createElement(
    "div",
    null,
    createElement("div", null, tr(lang, "update.description")),
    createElement(
      "div",
      {
        "data-pwa-update-metadata": "true",
        style: { marginTop: 6, fontSize: 11, lineHeight: 1.35, opacity: 0.82 },
      },
      createElement("div", null, `Current: ${currentBuildId}`),
      createElement("div", null, `Pending: ${pendingBuildId ?? "unknown"}`),
    ),
  );
}

function showUpdateToast(options: {
  currentBuildId: string;
  pendingBuildId: string | null;
  updateInProgress: boolean;
  onReload: () => void;
}): void {
  const lang = detectLang();
  sonnerToast(tr(lang, "update.title"), {
    id: TOAST_ID,
    description: updateDescription(options.currentBuildId, options.pendingBuildId),
    duration: Infinity,
    action: updateButton(tr(lang, "update.btn_reload"), options.updateInProgress, options.onReload),
  });
}

async function readRemoteVersion(): Promise<{ buildId?: string } | null> {
  const res = await fetch(`/version.json?ts=${Date.now()}`, {
    cache: "no-store",
    credentials: "omit",
  });
  if (!res.ok) return null;
  return (await res.json()) as { buildId?: string };
}

function startVersionPoller(
  onMismatch: (remoteBuildId: string) => void,
  onCurrent: (remoteBuildId: string) => void,
): () => void {
  let stopped = false;
  let timer: number | undefined;

  const check = async () => {
    if (stopped) return;
    try {
      const data = await readRemoteVersion();
      const currentBuildId = getCurrentBuildId();
      if (data?.buildId && data.buildId !== currentBuildId) {
        console.log(`[pwa-update] mismatch current=${currentBuildId} remote=${data.buildId}`);
        onMismatch(data.buildId);
      } else if (data?.buildId) {
        onCurrent(data.buildId);
      }
    } catch {
      /* network blip — try again next tick */
    }
  };

  const initialDelay = isE2EUpdateEnabled() ? (window.__SNOTE_E2E_PWA_INITIAL_POLL_MS__ ?? 50) : 3000;
  const interval = isE2EUpdateEnabled() ? (window.__SNOTE_E2E_PWA_POLL_INTERVAL_MS__ ?? 250) : VERSION_POLL_INTERVAL_MS;
  window.setTimeout(check, initialDelay);
  timer = window.setInterval(check, interval) as unknown as number;
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
  if (import.meta.env.DEV && !isE2EUpdateEnabled()) return;

  if (isLovablePreviewHost()) {
    void nukeServiceWorkersAndCaches();
    return;
  }

  let pendingBuildFromPreviousLoad: string | null = null;
  try {
    pendingBuildFromPreviousLoad = sessionStorage.getItem(PENDING_BUILD_KEY);
  } catch {
    /* ignore */
  }
  if (pendingBuildFromPreviousLoad && pendingBuildFromPreviousLoad === getCurrentBuildId()) {
    try {
      sessionStorage.removeItem(PENDING_BUILD_KEY);
    } catch {
      /* ignore */
    }
    pendingBuildFromPreviousLoad = null;
    sonnerToast.dismiss(TOAST_ID);
  }

  let updateAvailable = false;
  let latestRemoteBuildId: string | null = null;
  let waitingRegistration: ServiceWorkerRegistration | null = null;
  let updateSWFn: ((reload?: boolean) => Promise<void>) | null = null;
  let reloadInProgress = false;
  let reloadAttemptCount = 0;
  let reloadStrategy: ReloadStrategy = null;

  const renderToast = () => {
    showUpdateToast({
      currentBuildId: getCurrentBuildId(),
      pendingBuildId: latestRemoteBuildId ?? pendingBuildFromPreviousLoad,
      updateInProgress: reloadInProgress,
      onReload: reloadNow,
    });
  };

  const syncDebugState = () => {
    writeDebugState({
      pendingBuildId: latestRemoteBuildId ?? pendingBuildFromPreviousLoad,
      updateAvailable,
      updateInProgress: reloadInProgress,
      lastRemoteBuildId: latestRemoteBuildId,
      reloadAttemptCount,
      reloadStrategy,
    });
  };

  const reloadNow = () => {
    if (reloadInProgress) return;
    reloadInProgress = true;
    reloadAttemptCount += 1;
    const pendingBuildId = latestRemoteBuildId ?? pendingBuildFromPreviousLoad ?? "unknown";
    try {
      sessionStorage.setItem(PENDING_BUILD_KEY, pendingBuildId);
    } catch {
      /* ignore */
    }
    syncDebugState();
    writeDebugState({ pendingBuildId, lastAcceptedAt: Date.now() });
    renderToast();

    if (waitingRegistration?.waiting && updateSWFn) {
      reloadStrategy = "waiting-sw";
      syncDebugState();
      console.log("[pwa-update] reload strategy=waiting-sw", { currentBuildId: getCurrentBuildId(), pendingBuildId });
      const fallback = window.setTimeout(() => {
        console.log("[pwa-update] waiting-sw fallback → hard reload", { currentBuildId: getCurrentBuildId(), pendingBuildId });
        hardReload(pendingBuildId);
      }, 2500);
      let done = false;
      const onCtrl = () => {
        if (done) return;
        done = true;
        window.clearTimeout(fallback);
        hardReload(pendingBuildId);
      };
      navigator.serviceWorker?.addEventListener("controllerchange", onCtrl, { once: true });
      void updateSWFn(true).catch(() => {
        window.clearTimeout(fallback);
        hardReload(pendingBuildId);
      });
      return;
    }

    reloadStrategy = "hard";
    syncDebugState();
    console.log("[pwa-update] reload strategy=hard", { currentBuildId: getCurrentBuildId(), pendingBuildId });
    hardReload(pendingBuildId);
  };

  const triggerToast = () => {
    updateAvailable = true;
    syncDebugState();
    renderToast();
  };

  syncDebugState();
  startVersionPoller(
    (remoteBuildId) => {
      latestRemoteBuildId = remoteBuildId;
      pendingBuildFromPreviousLoad = remoteBuildId;
      triggerToast();
    },
    (remoteBuildId) => {
      if (remoteBuildId !== getCurrentBuildId()) return;
      updateAvailable = false;
      latestRemoteBuildId = remoteBuildId;
      reloadInProgress = false;
      try {
        if (sessionStorage.getItem(PENDING_BUILD_KEY) === remoteBuildId) {
          sessionStorage.removeItem(PENDING_BUILD_KEY);
        }
      } catch {
        /* ignore */
      }
      sonnerToast.dismiss(TOAST_ID);
      writeDebugState({
        pendingBuildId: null,
        updateAvailable,
        updateInProgress: false,
        lastRemoteBuildId: remoteBuildId,
        reloadAttemptCount,
        reloadStrategy,
      });
    },
  );

  if (!("serviceWorker" in navigator) || isE2EUpdateEnabled()) return;

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
    async onNeedRefresh() {
      try {
        const remote = await readRemoteVersion();
        if (remote?.buildId) latestRemoteBuildId = remote.buildId;
      } catch {
        /* keep previous poller value */
      }
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