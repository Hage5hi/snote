// Production recovery may unregister the same-origin app worker once when a
// pending update leaves the tab on a stale buildId. Healthy boots must not
// nuke. Recents / pins / encryption pins live in localStorage and must survive.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registerSWMock = vi.fn(() => async () => {});

vi.mock("virtual:pwa-register", () => ({
  registerSW: () => registerSWMock(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn() }),
}));

const RECENTS = JSON.stringify([{ slug: "keep-me", lastOpenedAt: 1 }]);
const PINS = JSON.stringify(["keep-me"]);
const THEME = "dark";
const ENC_PIN_KEY = "syrin:encryption-pin:keep-me";

function seedLocalAppState() {
  localStorage.setItem("note.recents", RECENTS);
  localStorage.setItem("note.pinned", PINS);
  localStorage.setItem("theme", THEME);
  localStorage.setItem(ENC_PIN_KEY, "1");
}

function expectLocalAppStateIntact() {
  expect(localStorage.getItem("note.recents")).toBe(RECENTS);
  expect(localStorage.getItem("note.pinned")).toBe(PINS);
  expect(localStorage.getItem("theme")).toBe(THEME);
  expect(localStorage.getItem(ENC_PIN_KEY)).toBe("1");
}

describe("PWA production recovery contract", () => {
  const originalSW = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  const originalCaches = (globalThis as unknown as { caches?: unknown }).caches;
  let unregisterCalls: string[] = [];
  let deletedCacheNames: string[] = [];

  beforeEach(() => {
    unregisterCalls = [];
    deletedCacheNames = [];
    sessionStorage.clear();
    localStorage.clear();
    seedLocalAppState();
    registerSWMock.mockClear();
    (window as unknown as { __SNOTE_E2E_ENABLE_PWA_UPDATE__?: boolean }).__SNOTE_E2E_ENABLE_PWA_UPDATE__ = true;
    (window as unknown as { __SNOTE_E2E_BUILD_ID__?: string }).__SNOTE_E2E_BUILD_ID__ = "build-a";
    (window as unknown as { __SNOTE_E2E_PWA_INITIAL_POLL_MS__?: number }).__SNOTE_E2E_PWA_INITIAL_POLL_MS__ = 10_000;
    (window as unknown as { __SNOTE_E2E_PWA_POLL_INTERVAL_MS__?: number }).__SNOTE_E2E_PWA_POLL_INTERVAL_MS__ = 10_000;
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = undefined;

    const regs = [
      { scriptURL: "https://note.syrin.online/sw.js" },
      { scriptURL: "https://note.syrin.online/service-worker.js" },
      { scriptURL: "https://note.syrin.online/firebase-messaging-sw.js" },
      { scriptURL: "https://note.syrin.online/OneSignalSDKWorker.js" },
    ].map(({ scriptURL }) => ({
      active: { scriptURL },
      unregister: vi.fn().mockImplementation(() => {
        unregisterCalls.push(scriptURL);
        return Promise.resolve(true);
      }),
    }));

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations: vi.fn().mockResolvedValue(regs) },
    });

    const allCacheNames = [
      "workbox-precache-v2-https://note.syrin.online/",
      "precache-v1-app-shell",
      "runtime-images",
      "workbox-runtime",
      "firebase-messaging-sw-cache",
      "onesignal-cache",
      "user-notes-cache",
    ];
    (globalThis as unknown as { caches: unknown }).caches = {
      keys: vi.fn().mockResolvedValue(allCacheNames),
      delete: vi.fn().mockImplementation((name: string) => {
        deletedCacheNames.push(name);
        return Promise.resolve(true);
      }),
    };
  });

  afterEach(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_CLEANUP__?: () => void }).__SNOTE_PWA_UPDATE_CLEANUP__?.();
    delete (window as unknown as { __SNOTE_PWA_UPDATE_CLEANUP__?: () => void }).__SNOTE_PWA_UPDATE_CLEANUP__;
    delete (window as unknown as { __SNOTE_E2E_ENABLE_PWA_UPDATE__?: boolean }).__SNOTE_E2E_ENABLE_PWA_UPDATE__;
    delete (window as unknown as { __SNOTE_E2E_BUILD_ID__?: string }).__SNOTE_E2E_BUILD_ID__;
    if (originalSW === undefined) {
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    } else {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: originalSW });
    }
    (globalThis as unknown as { caches?: unknown }).caches = originalCaches;
    sessionStorage.clear();
    localStorage.clear();
  });

  async function fresh() {
    vi.resetModules();
    return await import("../pwa-update");
  }

  it("does not unregister or delete caches on a healthy production boot", async () => {
    const { registerAppUpdater } = await fresh();
    registerAppUpdater();
    await new Promise((r) => setTimeout(r, 20));

    expect(unregisterCalls).toEqual([]);
    expect(deletedCacheNames).toEqual([]);
    expectLocalAppStateIntact();
  });

  it("recovers once when pending-build survives and the tab is still on a stale buildId", async () => {
    sessionStorage.setItem("pwa-update-pending-build", "build-b");
    const { registerAppUpdater } = await fresh();
    registerAppUpdater();
    await new Promise((r) => setTimeout(r, 20));

    expect(unregisterCalls).toEqual([
      "https://note.syrin.online/sw.js",
      "https://note.syrin.online/service-worker.js",
    ]);
    expect(deletedCacheNames).toEqual([
      "workbox-precache-v2-https://note.syrin.online/",
      "precache-v1-app-shell",
      "runtime-images",
      "workbox-runtime",
    ]);
    expect(sessionStorage.getItem("pwa-update-recovery-attempt")).toBeTruthy();
    expectLocalAppStateIntact();
  });

  it("does not recover again in the same session after the one-shot attempt", async () => {
    sessionStorage.setItem("pwa-update-pending-build", "build-b");
    sessionStorage.setItem("pwa-update-recovery-attempt", "1");
    const { registerAppUpdater } = await fresh();
    registerAppUpdater();
    await new Promise((r) => setTimeout(r, 20));

    expect(unregisterCalls).toEqual([]);
    expect(deletedCacheNames).toEqual([]);
    expectLocalAppStateIntact();
  });

  it("does not recover when pending-build already matches the running buildId", async () => {
    sessionStorage.setItem("pwa-update-pending-build", "build-a");
    const { registerAppUpdater } = await fresh();
    registerAppUpdater();
    await new Promise((r) => setTimeout(r, 20));

    expect(unregisterCalls).toEqual([]);
    expect(deletedCacheNames).toEqual([]);
    expect(sessionStorage.getItem("pwa-update-pending-build")).toBeNull();
    expectLocalAppStateIntact();
  });

  it("lazy-import recovery is allowed once even without a pending build, and still keeps recents", async () => {
    const { recoverMaroonedPwaUpdateOnce } = await fresh();
    const first = recoverMaroonedPwaUpdateOnce("lazy-import");
    await new Promise((r) => setTimeout(r, 20));
    expect(first).toBe(true);
    expect(unregisterCalls).toHaveLength(2);
    expectLocalAppStateIntact();

    unregisterCalls.length = 0;
    deletedCacheNames.length = 0;
    const second = recoverMaroonedPwaUpdateOnce("lazy-import");
    await new Promise((r) => setTimeout(r, 20));
    expect(second).toBe(false);
    expect(unregisterCalls).toEqual([]);
    expect(deletedCacheNames).toEqual([]);
    expectLocalAppStateIntact();
  });
});
