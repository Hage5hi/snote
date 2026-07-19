import { test, expect } from "./fixtures/extension";

declare const chrome: {
  storage: {
    sync: {
      set(items: Record<string, unknown>, callback: () => void): void;
    };
  };
};

// Both export surfaces (download + copy-to-clipboard) must apply
// redaction consistently. The copy path historically dumped the raw text
// of the log list — this spec guards the parity contract.
test.describe("debug export — copy path parity", () => {
  test("copy-to-clipboard redacts when toggle is on", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await serviceWorker.evaluate(async () => {
      await new Promise<void>((r) =>
        chrome.storage.sync.set({ debug: true }, () => r()),
      );
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForSelector("#debug-copy");

    // Seed a debug line containing a sensitive token.
    await page.evaluate(async () => {
      const debugModule = "./lib/debug.js";
      const { dlog } = await import(debugModule);
      dlog("ack sent", "my-secret-note-slug");
    });

    await page.check("#debug-redact");
    await page.click("#debug-copy");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.length).toBeGreaterThan(0);
    expect(copied).not.toContain("my-secret-note-slug");

    // Parse as JSON when copy now emits JSON; tolerate text fallback but
    // either way the slug must be masked.
    try {
      const parsed = JSON.parse(copied);
      const { validateExport } = await import(
        /* @vite-ignore */ `chrome-extension://${(await page.evaluate(() => location.host))}/lib/export-schema.js`
      ).catch(() => ({ validateExport: null }));
      if (validateExport) expect(validateExport(parsed).ok).toBe(true);
      expect(JSON.stringify(parsed)).not.toContain("my-secret-note-slug");
    } catch {
      // text-format fallback — masking still required.
      expect(copied).toMatch(/m•+g|<redacted>|<api-key>|m\*\*\*g/);
    }
  });

  test("copy-to-clipboard leaves text raw when toggle is off", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await serviceWorker.evaluate(async () => {
      await new Promise<void>((r) =>
        chrome.storage.sync.set({ debug: true }, () => r()),
      );
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForSelector("#debug-copy");
    await page.evaluate(async () => {
      const debugModule = "./lib/debug.js";
      const { dlog } = await import(debugModule);
      dlog("ack sent", "plain-slug-xyz");
    });

    expect(await page.isChecked("#debug-redact")).toBe(false);
    await page.click("#debug-copy");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("plain-slug-xyz");
  });
});
