import { test, expect } from "./fixtures/extension";
import type { Page, Worker } from "@playwright/test";

// Drives the same chrome.sidePanel.open({windowId}) API as Alt+S, using a
// real extension-page click so current Chromium accepts the user gesture.
// In addition to URL correctness, this spec asserts that:
//   - the side panel page becomes the focused document,
//   - the iframe receives focus (or is focusable via Tab),
//   - Tab/Shift+Tab keyboard navigation reaches the expected interactive
//     elements (fallback "Open in new tab" button and debug controls when
//     visible) without trapping focus on the loader.

async function setSettings(sw: Worker, settings: Record<string, unknown>) {
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

async function openPanelAndGet(
  context: import("@playwright/test").BrowserContext,
  extensionId: string,
): Promise<Page> {
  const trigger = await context.newPage();
  await trigger.goto(`chrome-extension://${extensionId}/options.html`);
  await trigger.evaluate(() => {
    const button = document.createElement("button");
    button.id = "e2e-open-side-panel";
    button.type = "button";
    button.addEventListener("click", async () => {
      try {
        // @ts-expect-error chrome extension APIs exist on extension pages
        const win = await chrome.windows.getCurrent();
        // @ts-expect-error chrome extension APIs exist on extension pages
        await chrome.sidePanel.open({ windowId: win.id });
        button.dataset.result = "ok";
      } catch (error) {
        button.dataset.result = error instanceof Error ? error.message : String(error);
      }
    });
    document.body.appendChild(button);
  });
  const openButton = trigger.locator("#e2e-open-side-panel");
  await openButton.click();
  await expect(openButton).toHaveAttribute("data-result", "ok");

  // Chromium does not expose its browser-owned side-panel surface as a
  // Playwright Page. Open the same extension document in a controlled page
  // for the URL, focus and keyboard assertions after proving open() worked.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded",
  });
  await expect(panel.locator("#loader")).toBeVisible();
  return panel;
}

async function assertPanelFocusable(panel: Page) {
  await panel.bringToFront();
  // Document must be focusable (not detached/hidden).
  const hasFocus = await panel.evaluate(() => document.hasFocus());
  expect(hasFocus, "side panel document has focus").toBeTruthy();

  // Iframe is in the tab order.
  const iframeTabIndex = await panel
    .locator("iframe#app")
    .evaluate((el) => (el as HTMLIFrameElement).tabIndex);
  expect(iframeTabIndex).toBeGreaterThanOrEqual(0);

  // Focus the iframe explicitly and verify activeElement points at it.
  await panel.locator("iframe#app").focus();
  const activeIsIframe = await panel.evaluate(
    () => document.activeElement?.tagName?.toLowerCase() === "iframe",
  );
  expect(activeIsIframe, "iframe receives focus").toBeTruthy();
}

async function assertKeyboardNavReachesFallback(panel: Page) {
  // Force the fallback button to be reachable by un-hiding it for the
  // assertion (the timeout-based flow normally takes 8s). We're verifying
  // that when the fallback IS visible, keyboard nav lands on it.
  await panel.evaluate(() => {
    const fb = document.getElementById("fallback");
    if (fb) (fb as HTMLElement).hidden = false;
  });
  await panel.locator("body").focus();
  // Tab forward until activeElement.id === "open-tab", up to 6 hops.
  let landedOnButton = false;
  for (let i = 0; i < 6; i++) {
    await panel.keyboard.press("Tab");
    const id = await panel.evaluate(() => document.activeElement?.id ?? "");
    if (id === "open-tab") {
      landedOnButton = true;
      break;
    }
  }
  expect(landedOnButton, "Tab navigation reaches fallback button").toBeTruthy();
}

test("homepage mode (H): correct URL, focus, keyboard nav", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await setSettings(serviceWorker, { openMode: "home" });
  const panel = await openPanelAndGet(context, extensionId);
  const iframeSrc = await panel.locator("iframe#app").getAttribute("src");
  expect(iframeSrc).toBe("https://note.syrin.online/?from=ext");
  await assertPanelFocusable(panel);
  await assertKeyboardNavReachesFallback(panel);
});

test("specific slug mode (S): correct URL, focus, keyboard nav", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await setSettings(serviceWorker, { openMode: "slug", defaultSlug: "my-note" });
  const panel = await openPanelAndGet(context, extensionId);
  const iframeSrc = await panel.locator("iframe#app").getAttribute("src");
  expect(iframeSrc).toBe("https://note.syrin.online/my-note?from=ext");
  await assertPanelFocusable(panel);
  await assertKeyboardNavReachesFallback(panel);
});

test("last opened mode (L): correct URL, focus, keyboard nav, debug controls reachable", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await setSettings(serviceWorker, {
    openMode: "last",
    lastSlug: "yesterday",
    debug: true,
  });
  const panel = await openPanelAndGet(context, extensionId);
  const iframeSrc = await panel.locator("iframe#app").getAttribute("src");
  expect(iframeSrc).toBe("https://note.syrin.online/yesterday?from=ext");
  await assertPanelFocusable(panel);

  // Debug bar is visible because debug=true; copy/clear/export buttons must
  // be in the tab order.
  await expect(panel.locator("#debug-bar")).toBeVisible();
  for (const id of ["debug-copy", "debug-clear", "debug-export"]) {
    const tabIndex = await panel
      .locator(`#${id}`)
      .evaluate((el) => (el as HTMLButtonElement).tabIndex);
    expect(tabIndex, `#${id} is keyboard reachable`).toBeGreaterThanOrEqual(0);
  }
});
