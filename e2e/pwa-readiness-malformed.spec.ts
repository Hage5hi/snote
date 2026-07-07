// E2E: feed invalid/malformed PWA readiness state and confirm the debug
// panel never renders and the update flow stays blocked. The panel gates
// on a truthy state object (see PwaUpdateDebugPanel.tsx: `!state` → null),
// so non-object / falsy values must keep it unmounted.
import { test, expect } from "@playwright/test";

const malformed: Array<{ label: string; value: unknown }> = [
  { label: "undefined", value: undefined },
  { label: "null", value: null },
  { label: "empty-string", value: "" },
  { label: "number-zero", value: 0 },
  { label: "boolean-false", value: false },
  { label: "empty-array", value: [] },
];

for (const { label, value } of malformed) {
  test(`readiness gate stays closed for malformed state: ${label}`, async ({ page }) => {
    await page.addInitScript((v) => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = v as never;
    }, value);
    await page.goto("/");
    // Give the panel's 500ms poller a few ticks.
    await page.waitForTimeout(1_200);
    const panel = page.locator("[data-pwa-debug-panel='true']");
    await expect(panel).toHaveCount(0);
    // Update flow is not surfaced (no update toast/button).
    await expect(page.getByRole("button", { name: /update|cập nhật/i })).toHaveCount(0);
  });
}
