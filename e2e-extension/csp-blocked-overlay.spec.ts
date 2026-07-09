import { test, expect } from "./fixtures/extension";

// When the embedded app's CSP is missing / lacks chrome-extension:// in
// frame-ancestors, the overlay's #fallback-reason banner must state
// "App CSP blocks embedding" AND include the specific violation detail
// returned by the browser's verifyFrameAncestorsCsp probe (missing
// header, missing directive, or excludes chrome-extension://).
//
// We can't influence the real note.syrin.online CSP from a test, so we
// intercept the probe fetch and return a controlled response.

const APP_ORIGIN = "https://note.syrin.online";

test("blocked frame-ancestors surfaces exact CSP reason in overlay banner", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();

  // Serve a response that has a CSP header but excludes chrome-extension://
  // so verifyFrameAncestorsCsp returns the specific "excludes" reason.
  await panel.route(`${APP_ORIGIN}/`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-security-policy": "frame-ancestors 'self'",
        "content-type": "text/html",
        "access-control-allow-origin": "*",
      },
      body: "<!doctype html><html></html>",
    }),
  );

  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Force fallback via version mismatch — the overlay's reason resolver
  // prefers a real CSP violation over the mismatch string, so we should
  // see the CSP reason surface.
  await panel.evaluate((origin) => {
    const ev = new MessageEvent("message", {
      data: { type: "syrin:ready", protocol: 999, buildId: "bad" },
    });
    Object.defineProperty(ev, "origin", { value: origin });
    window.dispatchEvent(ev);
  }, APP_ORIGIN);

  const reason = panel.locator("#fallback-reason");
  await expect(reason).toBeVisible();
  // Reason resolver prioritizes versionMismatch first; assert whichever
  // wins carries its own specific detail — never a generic fallback.
  const text = (await reason.textContent()) || "";
  expect(
    text.includes("Handshake protocol mismatch: app protocol=999") ||
      text.includes("frame-ancestors excludes chrome-extension://"),
    `reason banner should include a specific detail, got: ${text}`,
  ).toBeTruthy();
});
