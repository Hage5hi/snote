import { test, expect, openPanel, sendReady, waitForFallback } from "./fixtures/extension";

// The overlay's #fallback-reason must render EXACTLY the strings produced
// by sidepanel.js — those strings are the triage contract users report to
// us verbatim, so any wording drift must fail loudly.

test("version mismatch: reason banner matches exact string from sidepanel.js", async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  await sendReady(panel, { protocol: 999, buildId: "b-bad", appVersion: "9.9.9" });
  await waitForFallback(panel);

  const text = (await panel.locator("#fallback-reason").textContent())?.trim();
  expect(text).toBe(
    "Handshake protocol mismatch: app protocol=999 not in [1,2] (ext=2)",
  );

  // The diagnostics dl row must mirror the reason (single source of truth).
  const diagReady = (await panel.locator("#diag-ready").textContent())?.trim();
  expect(diagReady).toBe(
    "mismatch: app protocol=999 not in [1,2] (ext=2)",
  );
});
