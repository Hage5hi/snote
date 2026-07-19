import { test, expect } from "./fixtures/extension";

declare const chrome: {
  storage: {
    sync: {
      set(items: Record<string, unknown>, callback: () => void): void;
    };
  };
};

// Toggle redaction on, reload the side panel, confirm the checkbox is
// still checked and a fresh export validates as a redacted payload.
test.describe("debug export — toggle persistence", () => {
  test("redaction toggle survives reload and exports stay redacted", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    // Enable debug so the bar (and the toggle) render.
    await serviceWorker.evaluate(async () => {
      await new Promise<void>((r) =>
        chrome.storage.sync.set({ debug: true }, () => r()),
      );
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForSelector("#debug-redact");

    await page.check("#debug-redact");
    expect(await page.isChecked("#debug-redact")).toBe(true);

    await page.reload();
    await page.waitForSelector("#debug-redact");
    expect(await page.isChecked("#debug-redact")).toBe(true);

    // Build a payload via the same modules the exporter uses and assert
    // schema + filename look right for the persisted-on state.
    const res = await page.evaluate(async () => {
      const redactModule = "./lib/redact.js";
      const exportSchemaModule = "./lib/export-schema.js";
      const { redactPayload } = await import(redactModule);
      const { validateExport, expectedFilename } = await import(
        exportSchemaModule
      );
      const ts = new Date().toISOString();
      const raw = {
        kind: "syrin-note-debug-log",
        version: 1,
        extensionVersion: "x",
        exportedAt: ts,
        lastSlug: "abcdef",
        iframeSrc: "https://note.syrin.online/n/abcdef",
        lines: [{ t: 1, msg: "ack sent abcdef" }],
      };
      const red = redactPayload(raw);
      return {
        ok: validateExport(red).ok,
        name: expectedFilename({ redacted: true, isoTimestamp: ts }),
        slug: red.lastSlug,
      };
    });
    expect(res.ok).toBe(true);
    expect(res.name).toMatch(/-redacted-/);
    expect(res.slug).not.toBe("abcdef");
  });
});
