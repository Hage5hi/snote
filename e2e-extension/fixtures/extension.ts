import {
  test as base,
  chromium,
  type BrowserContext,
  type Worker,
} from "@playwright/test";
import path from "node:path";

// Loads chrome-extension/ as an unpacked extension in a persistent context.
// Exposes `context`, `extensionId`, and `serviceWorker` to specs.
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const extPath = path.resolve(__dirname, "..", "..", "chrome-extension");
    const ctx = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        "--no-first-run",
      ],
    });
    await use(ctx);
    await ctx.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

export const expect = test.expect;

// Helper: run a snippet inside the service worker.
export async function inSW<T>(sw: Worker, fn: () => Promise<T> | T): Promise<T> {
  return sw.evaluate(fn);
}

// App origin the side panel embeds. Kept here so specs share one constant.
export const APP_ORIGIN = "https://note.syrin.online";

// Deterministic readiness helpers so specs don't rely on sleeps. `openPanel`
// navigates to the side panel and waits for the loader to be present (i.e.
// sidepanel.js has attached the message listener). `sendReady` posts a
// synthetic syrin:ready with a controlled protocol/buildId. `waitForReady`
// converges on the panel's post-handshake steady state: loader hidden,
// fallback hidden, iframe visible.
import type { Page } from "@playwright/test";

export async function openPanel(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded",
  });
  await expect(panel.locator("#loader")).toBeVisible();
  return panel;
}

export async function sendReady(
  panel: Page,
  opts: { protocol?: number; buildId?: string; appVersion?: string } = {},
) {
  const protocol = opts.protocol ?? 2;
  const buildId = opts.buildId ?? "test-build";
  const appVersion = opts.appVersion ?? "test";
  await panel.evaluate(
    ({ origin, protocol, buildId, appVersion }) => {
      const ev = new MessageEvent("message", {
        data: { type: "syrin:ready", protocol, buildId, appVersion },
      });
      Object.defineProperty(ev, "origin", { value: origin });
      window.dispatchEvent(ev);
    },
    { origin: APP_ORIGIN, protocol, buildId, appVersion },
  );
}

export async function waitForReady(panel: Page) {
  await expect(panel.locator("#loader")).toHaveClass(/hidden/);
  await expect(panel.locator("#fallback")).toBeHidden();
}

export async function waitForFallback(panel: Page) {
  await expect(panel.locator("#fallback")).toBeVisible();
  await expect(panel.locator("#fallback-reason")).toBeVisible();
}
