// Shared toast-lifecycle helpers for E2E specs.
//
// All timing thresholds are configurable via E2E_TOAST_* environment
// variables so the same suite runs against fast local dev machines and
// slower CI runners without code changes. See docs/e2e-toast-timing.md.
import { expect, type Locator } from "@playwright/test";

const CI_MULT = process.env.CI ? 2 : 1;

export const TOAST_TIMEOUT =
  Number(process.env.E2E_TOAST_TIMEOUT_MS ?? 5_000) * CI_MULT;

// Sonner default auto-dismiss ≈ 4s. Allow generous slack for slow browsers.
export const TOAST_DISMISS_TIMEOUT =
  Number(process.env.E2E_TOAST_DISMISS_TIMEOUT_MS ?? 8_000) * CI_MULT;

// Minimum time a toast should remain visible before auto-dismiss.
export const TOAST_MIN_VISIBLE_MS = Number(
  process.env.E2E_TOAST_MIN_VISIBLE_MS ?? 200,
);

/**
 * Assert that a toast:
 *   1. becomes visible within TOAST_TIMEOUT
 *   2. stays visible for at least TOAST_MIN_VISIBLE_MS (catches flicker)
 *   3. auto-dismisses within TOAST_DISMISS_TIMEOUT (catches lingering)
 *
 * Throws (and therefore fails the test) if any condition is violated.
 */
export async function expectToastLifecycle(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: TOAST_TIMEOUT });
  await locator.page().waitForTimeout(TOAST_MIN_VISIBLE_MS);
  await expect(locator).toBeVisible();
  await expect(locator).toBeHidden({ timeout: TOAST_DISMISS_TIMEOUT });
}
