// Deterministic PWA-update mock for E2E specs.
//
// Wraps the ad-hoc addInitScript + page.route boilerplate used by
// pwa-update-*.spec.ts so every spec configures the fake service worker /
// hard-reload path the same way, and results are repeatable across runs and
// browsers (chromium/firefox/webkit).
//
// Key guarantees:
// - Uses fixed buildIds (no Date.now / Math.random anywhere in the setup).
// - Fixed poll intervals (initial 10ms, interval 250ms by default).
// - Optionally "holds" the hard-reload event so tests can inspect the
//   pending state deterministically and release it on demand.

import type { Page } from "@playwright/test";

export type PwaMockOptions = {
  fromBuildId: string;
  toBuildId: string;
  /** When true, defer applying the new buildId until releaseHeldReload() runs. */
  holdHardReload?: boolean;
  initialPollMs?: number;
  pollIntervalMs?: number;
};

export async function installPwaUpdateMock(page: Page, opts: PwaMockOptions): Promise<void> {
  const cfg = {
    initialPollMs: 10,
    pollIntervalMs: 250,
    holdHardReload: false,
    ...opts,
  };
  await page.addInitScript((c) => {
    (window as any).__SNOTE_E2E_ENABLE_PWA_UPDATE__ = true;
    (window as any).__SNOTE_E2E_BUILD_ID__ = c.fromBuildId;
    (window as any).__SNOTE_E2E_PWA_INITIAL_POLL_MS__ = c.initialPollMs;
    (window as any).__SNOTE_E2E_PWA_POLL_INTERVAL_MS__ = c.pollIntervalMs;
    (window as any).__SNOTE_E2E_HARD_RELOAD_COUNT__ = 0;
    (window as any).__SNOTE_E2E_HELD_TARGET__ = null;
    window.addEventListener("snote:e2e-pwa-hard-reload", (e: Event) => {
      (window as any).__SNOTE_E2E_HARD_RELOAD_COUNT__ += 1;
      const target = (e as CustomEvent).detail.targetBuildId;
      if (c.holdHardReload) {
        (window as any).__SNOTE_E2E_BUILD_ID__ = c.fromBuildId;
        (window as any).__SNOTE_E2E_HELD_TARGET__ = target;
      } else {
        (window as any).__SNOTE_E2E_BUILD_ID__ = target;
      }
    });
  }, cfg);
  await page.route("**/version.json**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ buildId: opts.toBuildId }),
    }),
  );
}

/** Release a held hard-reload so the toast transitions to the new buildId. */
export async function releaseHeldReload(page: Page): Promise<void> {
  await page.evaluate(() => {
    const t = (window as any).__SNOTE_E2E_HELD_TARGET__;
    if (t) (window as any).__SNOTE_E2E_BUILD_ID__ = t;
  });
}

export async function getHardReloadCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__SNOTE_E2E_HARD_RELOAD_COUNT__ ?? 0);
}
