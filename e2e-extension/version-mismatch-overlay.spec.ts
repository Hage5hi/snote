import { test, expect } from "./fixtures/extension";

// When the app broadcasts a syrin:ready with an unsupported protocol
// version, the side panel must show the fallback overlay AND populate
// the prominent #fallback-reason banner with the exact mismatch string
// (extension protocol range vs app protocol). This is the triage signal
// users report to us verbatim, so its wording is contract.

const APP_ORIGIN = "https://note.syrin.online";

test("handshake version mismatch fills #fallback-reason with exact detail", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate((origin) => {
    const ev = new MessageEvent("message", {
      data: { type: "syrin:ready", protocol: 999, buildId: "b-bad", appVersion: "9.9.9" },
    });
    Object.defineProperty(ev, "origin", { value: origin });
    window.dispatchEvent(ev);
  }, APP_ORIGIN);

  const reason = panel.locator("#fallback-reason");
  await expect(reason).toBeVisible();
  await expect(reason).toContainText("Handshake protocol mismatch");
  await expect(reason).toContainText("app protocol=999");
  await expect(reason).toContainText("ext=2");

  // Diagnostics row must mirror the reason for a consistent story.
  await expect(panel.locator("#diag-ready")).toContainText(/mismatch.*app protocol=999/);
});
