import { test, expect } from "./fixtures/extension";
import { readFileSync } from "node:fs";

// Both export surfaces (download + copy-to-clipboard) must apply
// redaction consistently. The copy path historically dumped the raw text
// of the log list — this spec guards the parity contract.
test.describe("debug export — copy path parity", () => {
  test("copy-to-clipboard is forcibly redacted", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await serviceWorker.evaluate(async () => {
      await new Promise<void>((r) =>
        // @ts-expect-error chrome global in extension service worker
        chrome.storage.sync.set({ debug: true }, () => r()),
      );
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForSelector("#debug-copy");

    // Seed a debug line containing a sensitive token.
    await page.evaluate(async () => {
      const debugModulePath = "./lib/debug.js";
      const { dlog } = await import(debugModulePath);
      dlog("ack sent", "my-secret-note-slug");
    });

    expect(await page.isChecked("#debug-redact")).toBe(true);
    expect(await page.isDisabled("#debug-redact")).toBe(true);
    await page.click("#debug-copy");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.length).toBeGreaterThan(0);
    expect(copied).not.toContain("my-secret-note-slug");

    const parsed = JSON.parse(copied);
    const { validateExport } = await import(
      /* @vite-ignore */ `chrome-extension://${(await page.evaluate(() => location.host))}/lib/export-schema.js`
    ).catch(() => ({ validateExport: null }));
    if (validateExport) expect(validateExport(parsed).ok).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("my-secret-note-slug");
  });

  test("copy and download emit equivalent forced-redaction payloads", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await serviceWorker.evaluate(async () => {
      await new Promise<void>((r) =>
        // @ts-expect-error chrome global in extension service worker
        chrome.storage.sync.set({ debug: true }, () => r()),
      );
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForSelector("#debug-copy");
    await page.evaluate(async () => {
      const debugModulePath = "./lib/debug.js";
      const { dlog } = await import(debugModulePath);
      dlog("ack sent", "parity-secret-slug");
    });

    expect(await page.isChecked("#debug-redact")).toBe(true);
    expect(await page.isDisabled("#debug-redact")).toBe(true);
    await page.click("#debug-copy");
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#debug-export"),
    ]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const downloaded = JSON.parse(readFileSync(filePath!, "utf8"));
    const withoutTimestamp = ({ exportedAt: _exportedAt, ...rest }) => rest;

    expect(withoutTimestamp(downloaded)).toEqual(withoutTimestamp(copied));
    expect(JSON.stringify(copied)).not.toContain("parity-secret-slug");
    expect(JSON.stringify(downloaded)).not.toContain("parity-secret-slug");
    expect(copied.redacted).toBe(true);
    expect(downloaded.redacted).toBe(true);
  });
});
