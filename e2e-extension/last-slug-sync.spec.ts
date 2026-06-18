import { test, expect } from "./fixtures/extension";

// Verifies the side panel saves lastSlug when the embedded app posts
// `syrin:slug`. Posts from inside the panel page (same origin requirement
// is bypassed via direct postMessage — but we still simulate the realistic
// flow: parent receives, validates origin, writes storage).
test("sidepanel saves lastSlug from postMessage", async ({ context, extensionId, serviceWorker }) => {
  // Clear storage + open side panel by manually navigating the panel page in
  // a tab (works for asserting message handling).
  await serviceWorker.evaluate(
    () =>
      new Promise<void>((resolve) => {
        // @ts-expect-error chrome global in SW
        chrome.storage.sync.clear(() => resolve());
      }),
  );

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Fake the message origin check by patching event.origin via evaluate.
  // Since the listener checks event.origin === APP_ORIGIN, we dispatch a
  // synthetic MessageEvent through a stub origin getter.
  await panel.evaluate(() => {
    const ev = new MessageEvent("message", {
      data: { type: "syrin:slug", slug: "from-app" },
    });
    Object.defineProperty(ev, "origin", { value: "https://note.syrin.online" });
    window.dispatchEvent(ev);
  });

  // Allow chrome.storage.set to flush.
  await panel.waitForTimeout(200);
  const stored = await serviceWorker.evaluate(
    () =>
      new Promise((resolve) => {
        // @ts-expect-error chrome global in SW
        chrome.storage.sync.get({ lastSlug: "" }, resolve);
      }),
  );
  expect(stored).toMatchObject({ lastSlug: "from-app" });
});
