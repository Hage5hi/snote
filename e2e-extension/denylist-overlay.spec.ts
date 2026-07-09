import { test, expect, openPanel, sendReady, waitForFallback } from "./fixtures/extension";

// When the diagnostics bundle contains a forbidden key (denylist in
// lib/diagnostics-schema.js), the overlay MUST:
//   1. Surface a validation error banner naming the leaked key.
//   2. NOT put a bad payload on the clipboard / to disk.
//
// The extension exposes a test-only hook (window.__SYRIN_TEST_INJECT_FORBIDDEN_KEY__)
// so we can trigger this path without ever handling real PII.

test("forbidden key in bundle: overlay shows denylist error and copy is blocked", async ({
  context,
  extensionId,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: `chrome-extension://${extensionId}`,
  });

  const panel = await openPanel(context, extensionId);

  // Inject BEFORE triggering fallback so buildDiagnosticsBundle picks it up.
  await panel.evaluate(() => {
    (window as unknown as { __SYRIN_TEST_INJECT_FORBIDDEN_KEY__?: string })
      .__SYRIN_TEST_INJECT_FORBIDDEN_KEY__ = "authToken";
  });

  // Pre-seed clipboard with a sentinel so we can assert it wasn't overwritten
  // by a bad payload.
  await panel.evaluate(() => navigator.clipboard.writeText("SENTINEL_UNCHANGED"));

  await sendReady(panel, { protocol: 999, buildId: "deny-fixture" });
  await waitForFallback(panel);

  await panel.locator("#fallback-copy-diag").click();

  // Validation banner: visible, non-empty, includes the forbidden key name.
  const banner = panel.locator("#diag-validation");
  await expect(banner).toBeVisible();
  const text = (await banner.textContent()) || "";
  expect(text).toContain("Diagnostics bundle failed schema validation");
  expect(text).toContain("forbidden key present: authToken");

  // Copy MUST have been blocked — clipboard still holds the sentinel.
  const clip = await panel.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe("SENTINEL_UNCHANGED");

  // Download button must also refuse. If it silently produced a file, this
  // waitForEvent would resolve with a bad bundle. We race a short timeout
  // instead and expect NO download event.
  let downloadFired = false;
  const downloadPromise = panel
    .waitForEvent("download", { timeout: 1500 })
    .then(() => {
      downloadFired = true;
    })
    .catch(() => {
      /* expected: no download */
    });
  await panel.locator("#diag-download").click();
  await downloadPromise;
  expect(downloadFired).toBe(false);
});
