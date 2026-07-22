// The production app must preserve its active worker and caches as the offline
// rollback when an update stalls. Destructive cleanup is preview-host-only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:pwa-register", () => ({ registerSW: () => async () => {} }));

import { nukeServiceWorkersAndCaches } from "@/lib/pwa-update";

type FakeReg = { scriptURL: string; unregister: ReturnType<typeof vi.fn> };

function makeReg(scriptURL: string): { active: FakeReg; unregister: FakeReg["unregister"] } {
  const unregister = vi.fn().mockResolvedValue(true);
  return { active: { scriptURL, unregister }, unregister } as unknown as {
    active: FakeReg;
    unregister: FakeReg["unregister"];
  };
}

describe("nukeServiceWorkersAndCaches — production safety", () => {
  const originalSW = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  const originalCaches = (globalThis as unknown as { caches?: unknown }).caches;
  let unregisterCalls: string[] = [];
  let deletedCacheNames: string[] = [];

  beforeEach(() => {
    unregisterCalls = [];
    deletedCacheNames = [];

    const regs = [
      { scriptURL: "https://example.com/sw.js" },
      { scriptURL: "https://example.com/service-worker.js" },
      { scriptURL: "https://example.com/firebase-messaging-sw.js" },
      { scriptURL: "https://example.com/OneSignalSDKWorker.js" },
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
      "workbox-precache-v2-https://example.com/",
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
    if (originalSW === undefined) {
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    } else {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: originalSW });
    }
    (globalThis as unknown as { caches?: unknown }).caches = originalCaches;
  });

  it("does not unregister any worker on a production host", async () => {
    await nukeServiceWorkersAndCaches();
    expect(unregisterCalls).toEqual([]);
  });

  it("does not delete any cache on a production host", async () => {
    await nukeServiceWorkersAndCaches();
    expect(deletedCacheNames).toEqual([]);
  });
});
