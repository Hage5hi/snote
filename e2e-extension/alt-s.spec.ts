import { test, expect, inSW } from "./fixtures/extension";

// Drives the same code path Alt+S triggers: chrome.sidePanel.open({windowId}).
// Verifies the side panel opens with the URL computed from buildSrc() for
// each openMode.

async function setSettings(sw: import("@playwright/test").Worker, settings: Record<string, unknown>) {
  await sw.evaluate(
    (s) =>
      new Promise<void>((resolve) => {
        // @ts-expect-error chrome global in SW
        chrome.storage.sync.clear(() => {
          // @ts-expect-error chrome global in SW
          chrome.storage.sync.set(s, () => resolve());
        });
      }),
    settings,
  );
}

test("opens to homepage by default (H badge)", async ({ context, serviceWorker, extensionId }) => {
  await setSettings(serviceWorker, { openMode: "home" });
  await inSW(serviceWorker, async () => {
    // @ts-expect-error chrome global in SW
    const win = await chrome.windows.getCurrent();
    // @ts-expect-error chrome global in SW
    await chrome.sidePanel.open({ windowId: win.id });
  });
  const page = await context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
  // Side panel pages don't always emit "page"; fall back to scanning.
  const pages = page ? [page] : context.pages();
  const panel = pages.find((p) => p.url().startsWith(`chrome-extension://${extensionId}/sidepanel.html`));
  expect(panel, "side panel page exists").toBeTruthy();
  const iframeSrc = await panel!.locator("iframe#app").getAttribute("src");
  expect(iframeSrc).toBe("https://note.syrin.online/?from=ext");
});

test("opens to specific slug (S badge)", async ({ context, serviceWorker, extensionId }) => {
  await setSettings(serviceWorker, { openMode: "slug", defaultSlug: "my-note" });
  await inSW(serviceWorker, async () => {
    // @ts-expect-error chrome global in SW
    const win = await chrome.windows.getCurrent();
    // @ts-expect-error chrome global in SW
    await chrome.sidePanel.open({ windowId: win.id });
  });
  const panel = context
    .pages()
    .find((p) => p.url().startsWith(`chrome-extension://${extensionId}/sidepanel.html`));
  expect(panel).toBeTruthy();
  const iframeSrc = await panel!.locator("iframe#app").getAttribute("src");
  expect(iframeSrc).toBe("https://note.syrin.online/my-note?from=ext");
});

test("opens to last slug (L badge)", async ({ context, serviceWorker, extensionId }) => {
  await setSettings(serviceWorker, { openMode: "last", lastSlug: "yesterday" });
  await inSW(serviceWorker, async () => {
    // @ts-expect-error chrome global in SW
    const win = await chrome.windows.getCurrent();
    // @ts-expect-error chrome global in SW
    await chrome.sidePanel.open({ windowId: win.id });
  });
  const panel = context
    .pages()
    .find((p) => p.url().startsWith(`chrome-extension://${extensionId}/sidepanel.html`));
  expect(panel).toBeTruthy();
  const iframeSrc = await panel!.locator("iframe#app").getAttribute("src");
  expect(iframeSrc).toBe("https://note.syrin.online/yesterday?from=ext");
});
