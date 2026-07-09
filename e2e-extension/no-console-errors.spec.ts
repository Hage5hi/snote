import { test, expect } from "./fixtures/extension";

// Regression guard: rapid open/close of the side panel and reloads must
// never produce a runtime JS exception, an unhandled promise rejection,
// or a console.error from our own code. If a stray postMessage or a
// handshake edge case ever throws, this spec fails immediately with the
// captured message so we don't have to reproduce it by hand.

const APP_ORIGIN = "https://note.syrin.online";

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
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    // Send a valid ready so the panel converges before we tear it down.
    await panel.evaluate((origin) => {
      const ev = new MessageEvent("message", {
        data: { type: "syrin:ready", protocol: 2, buildId: `b${Math.random()}`, appVersion: "test" },
      });
      Object.defineProperty(ev, "origin", { value: origin });
      window.dispatchEvent(ev);
    }, APP_ORIGIN);
    await panel.reload();
    // Send a stray odd-protocol message after ready — must be ignored, not thrown.
    await panel.evaluate((origin) => {
      const ev = new MessageEvent("message", {
        data: { type: "syrin:ready", protocol: 999, buildId: "stray" },
      });
      Object.defineProperty(ev, "origin", { value: origin });
      window.dispatchEvent(ev);
    }, APP_ORIGIN);
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
