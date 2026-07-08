// Verifies registerAppUpdater() cleans up previous listeners/timers when
// called again (e.g. HMR, dev panel remount) so we never accumulate duplicate
// visibilitychange/focus/storage/i18n listeners or version pollers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:pwa-register", () => ({ registerSW: () => async () => {} }));

import { registerAppUpdater } from "@/lib/pwa-update";

describe("registerAppUpdater listener dedup", () => {
  const originalAdd = window.addEventListener;
  const originalRemove = window.removeEventListener;
  const originalDocAdd = document.addEventListener;
  const originalDocRemove = document.removeEventListener;
  let winAdds = 0;
  let winRemoves = 0;
  let docAdds = 0;
  let docRemoves = 0;

  beforeEach(() => {
    winAdds = winRemoves = docAdds = docRemoves = 0;
    window.addEventListener = ((...args: Parameters<typeof originalAdd>) => {
      winAdds++;
      return originalAdd.apply(window, args);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((...args: Parameters<typeof originalRemove>) => {
      winRemoves++;
      return originalRemove.apply(window, args);
    }) as typeof window.removeEventListener;
    document.addEventListener = ((...args: Parameters<typeof originalDocAdd>) => {
      docAdds++;
      return originalDocAdd.apply(document, args);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((...args: Parameters<typeof originalDocRemove>) => {
      docRemoves++;
      return originalDocRemove.apply(document, args);
    }) as typeof document.removeEventListener;
    (window as unknown as { __SNOTE_E2E_ENABLE_PWA_UPDATE__?: boolean }).__SNOTE_E2E_ENABLE_PWA_UPDATE__ = true;
    (window as unknown as { __SNOTE_E2E_BUILD_ID__?: string }).__SNOTE_E2E_BUILD_ID__ = "test-build";
  });

  afterEach(() => {
    window.__SNOTE_PWA_UPDATE_CLEANUP__?.();
    window.addEventListener = originalAdd;
    window.removeEventListener = originalRemove;
    document.addEventListener = originalDocAdd;
    document.removeEventListener = originalDocRemove;
  });

  it("cleans up listeners on subsequent registerAppUpdater() calls", () => {
    registerAppUpdater();
    const winAddsAfterFirst = winAdds;
    const docAddsAfterFirst = docAdds;
    expect(winAddsAfterFirst).toBeGreaterThan(0);

    // Remount: second call must remove first-call listeners before adding new ones.
    registerAppUpdater();
    expect(winRemoves).toBeGreaterThanOrEqual(winAddsAfterFirst - 0);
    expect(docRemoves).toBeGreaterThanOrEqual(docAddsAfterFirst - 0);

    // And an explicit teardown removes what the second call added.
    const winAddsBeforeTeardown = winAdds;
    const docAddsBeforeTeardown = docAdds;
    window.__SNOTE_PWA_UPDATE_CLEANUP__?.();
    expect(winRemoves).toBeGreaterThanOrEqual(winAddsBeforeTeardown - 0);
    expect(docRemoves).toBeGreaterThanOrEqual(docAddsBeforeTeardown - 0);
  });
});
