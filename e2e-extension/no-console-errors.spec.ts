import { test, expect, openPanel, sendReady, waitForReady } from "./fixtures/extension";

// Regression guard: rapid open/close of the side panel and reloads must
// never produce a runtime JS exception, an unhandled promise rejection,
// or a console.error from our own code. Uses the shared readiness helpers
// (loader.hidden + fallback hidden) so it's stable on slow CI runners.

test("no console errors or exceptions during rapid open/close + reload", async ({
  context,
  extensionId,
}) => {
  const errors: string[] = [];
  context.on("weberror", (err) => errors.push(`weberror: ${err.error().message}`));

  const cycle = async (i: number) => {
    const panel = await openPanel(context, extensionId);
    panel.on("pageerror", (err) => errors.push(`pageerror[${i}]: ${err.message}`));
    panel.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error[${i}]: ${msg.text()}`);
    });

    await sendReady(panel, { buildId: `b${i}-a` });
    await waitForReady(panel);

    await panel.reload({ waitUntil: "domcontentloaded" });
    await expect(panel.locator("#loader")).toBeVisible();
    await sendReady(panel, { buildId: `b${i}-b` });
    await waitForReady(panel);

    // Stray odd-protocol ready must be ignored — panel must stay ready.
    await sendReady(panel, { protocol: 999, buildId: "stray" });
    await expect(panel.locator("#fallback")).toBeHidden();

    await panel.close();
  };

  for (let i = 0; i < 4; i++) await cycle(i);

  const relevant = errors.filter(
    (e) => !/net::ERR|ERR_BLOCKED_BY|Failed to load resource/i.test(e),
  );
  expect(relevant, `Unexpected runtime errors:\n${relevant.join("\n")}`).toEqual([]);
});
