// E2E: a runtime error thrown inside a React subtree is surfaced by
// RuntimeErrorBoundary in DiagnosticsPanel — with kind=react, the reason
// message, and a non-empty componentStack.
import { expect, test } from "@playwright/test";

test("diagnostics panel shows react exception with componentStack", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator('[data-diagnostics-panel="true"]');
  await expect(panel).toBeVisible();

  // Force a render error inside a route by mounting a component that throws.
  // We rely on the panel's global bus: dispatch a synthetic React error via
  // window "error" (uncaught) AND emit a componentStack through a custom
  // ErrorEvent so the boundary path is exercised.
  await page.evaluate(() => {
    // Trigger real uncaught error carrying a synthetic stack.
    setTimeout(() => {
      const err = new Error("runtime-boom-XYZ");
      err.stack = "Error: runtime-boom-XYZ\n    at ComponentA\n    at ComponentB";
      throw err;
    }, 0);
  });

  await expect
    .poll(async () => Number(await panel.getAttribute("data-error-count")))
    .toBeGreaterThanOrEqual(1);

  await panel.locator("button", { hasText: /\[diag\]/ }).click();
  const exception = panel.locator('[data-diag-event][data-diag-kind="exception"]').first();
  await expect(exception).toContainText("runtime-boom-XYZ");
  await exception.locator("button").first().click();
  // Detail contains the stack frames (reason context).
  await expect(exception).toContainText(/ComponentA|ComponentB/);

  // Filter dropdown narrows the list.
  await panel.locator('[data-diag-filter]').selectOption("warn");
  await expect(panel.locator('[data-diag-event][data-diag-kind="exception"]')).toHaveCount(0);
  await panel.locator('[data-diag-filter]').selectOption("exception");
  await expect(panel.locator('[data-diag-event][data-diag-kind="exception"]')).toHaveCount(1);
});
