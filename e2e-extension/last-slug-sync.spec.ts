import { test, expect } from "./fixtures/extension";

// Verifies the side panel saves lastSlug only when the embedded app posts
// `syrin:slug`. The listener must validate both the exact origin and the
// MessageEvent source window before writing synced storage.
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

  // A same-origin event from any window other than the embedded app must not
  // be allowed to overwrite the device-local locator.
  await panel.evaluate(() => {
    const ev = new MessageEvent("message", {
      data: { type: "syrin:slug", slug: "forged-source" },
      source: window,
    });
    Object.defineProperty(ev, "origin", { value: "https://note.syrin.online" });
    window.dispatchEvent(ev);
  });

  await panel.waitForTimeout(100);
  const forged = await serviceWorker.evaluate(
    () => new Promise((resolve) => {
      // @ts-expect-error chrome global in extension service worker
      chrome.storage.sync.get("lastSlug", resolve);
    }),
  );
  expect(forged).not.toMatchObject({ lastSlug: "forged-source" });

  await panel.evaluate(() => {
    const ev = new MessageEvent("message", {
      data: { type: "syrin:slug", slug: "from-app" },
      source: (document.getElementById("app") as HTMLIFrameElement).contentWindow,
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
