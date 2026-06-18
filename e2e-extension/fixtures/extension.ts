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
  // @ts-expect-error - evaluate signature
  return sw.evaluate(fn);
}
