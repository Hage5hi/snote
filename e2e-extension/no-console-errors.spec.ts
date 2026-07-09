import { test, expect } from "./fixtures/extension";

// Regression guard: rapid open/close of the side panel and reloads must
// never produce a runtime JS exception, an unhandled promise rejection,
// or a console.error from our own code. Uses deterministic readiness
// waits (loader hidden after ready, fallback stays hidden) instead of
// arbitrary sleeps so it's stable on slow CI runners.

const APP_ORIGIN = "https://note.syrin.online";

async function sendReady(
  panel: import("@playwright/test").Page,
  protocol: number,
  buildId: string,
) {
  await panel.evaluate(
    ({ origin, protocol, buildId }) => {
      const ev = new MessageEvent("message", {
        data: { type: "syrin:ready", protocol, buildId, appVersion: "test" },
      });
      Object.defineProperty(ev, "origin", { value: origin });
      window.dispatchEvent(ev);
    },
    { origin: APP_ORIGIN, protocol, buildId },
  );
}

test("no console errors or exceptions during rapid open/close + reload", async ({
  context,
  extensionId,
}) => {
  const errors: string[] = [];
  context.on("weberror", (err) => errors.push(`weberror: ${err.error().message}`));

  const openOnce = async (i: number) => {
    const panel = await context.newPage();
    panel.on("pageerror", (err) => errors.push(`pageerror[${i}]: ${err.message}`));
    panel.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error[${i}]: ${msg.text()}`);
    });

    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded",
    });
    // Wait for the panel's message listener to be wired up — the loader
    // node exists only after sidepanel.js runs.
    await expect(panel.locator("#loader")).toBeVisible();

    await sendReady(panel, 2, `b${i}-a`);
    // Deterministic readiness signal: loader gains .hidden class, fallback stays hidden.
    await expect(panel.locator("#loader")).toHaveClass(/hidden/);
    await expect(panel.locator("#fallback")).toBeHidden();

    await panel.reload({ waitUntil: "domcontentloaded" });
    await expect(panel.locator("#loader")).toBeVisible();
    await sendReady(panel, 2, `b${i}-b`);
    await expect(panel.locator("#loader")).toHaveClass(/hidden/);

    // Stray odd-protocol ready must be ignored — panel must stay ready.
    await sendReady(panel, 999, "stray");
    await expect(panel.locator("#fallback")).toBeHidden();

    await panel.close();
  };

  for (let i = 0; i < 4; i++) await openOnce(i);

  // Filter noise from Chromium's own logging (net::ERR from the iframe not
  // reaching the real app in the test harness is expected here).
  const relevant = errors.filter(
    (e) => !/net::ERR|ERR_BLOCKED_BY|Failed to load resource/i.test(e),
  );
  expect(relevant, `Unexpected runtime errors:\n${relevant.join("\n")}`).toEqual([]);
});
