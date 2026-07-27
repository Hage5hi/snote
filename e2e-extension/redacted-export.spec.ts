import { test, expect } from "./fixtures/extension";

// Verifies the redaction + schema modules behave as advertised:
// - redacted exports mask structured locators and classify free-form lines
// - schema validation passes for both redacted and non-redacted shapes
// - filename contract matches expectedFilename()
//
// We import the ESM modules directly inside an extension page so we get
// real, in-browser execution (regex behavior, URL parser, etc.) without
// needing to script an actual download flow through the side panel host.

test.describe("debug export — redaction & schema", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    // Make sure we have a page on the extension origin so dynamic imports
    // resolve relative URLs against chrome-extension://<id>/.
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  });

  test("redactPayload masks locators and replaces free-form lines with safe classes", async ({
    context,
    extensionId,
  }) => {
    const page = context.pages().find((p) => p.url().includes(extensionId))!;
    const result = await page.evaluate(async () => {
      const redactModule = "./lib/redact.js";
      const { redactPayload } = await import(redactModule);
      const raw = {
        kind: "syrin-note-debug-log",
        version: 1,
        extensionVersion: "9.9.9",
        exportedAt: new Date().toISOString(),
        lastSlug: "my-secret-note-slug",
        iframeSrc: "https://note.syrin.online/n/my-secret-note-slug?token=abc123",
        lines: [
          { t: 1, msg: "ack sent my-secret-note-slug" },
          { t: 2, msg: "loading https://note.syrin.online/n/abc?token=xyz" },
          {
            t: 3,
            msg: "user alice@example.com bearer=eyJabc.def.ghiJKLmnopQRStuv hit /Users/alice/notes",
          },
          {
            t: 4,
            msg: "stripe sk_live_ABCDEFGHIJKLMNOPQRSTUVWX uuid 11111111-2222-3333-4444-555555555555",
          },
        ],
      };
      const out = redactPayload(raw);
      return out;
    });

    expect(result.redacted).toBe(true);
    // lastSlug masked.
    expect(result.lastSlug).not.toBe("my-secret-note-slug");
    expect(result.lastSlug).toMatch(/^m•+g$/);
    // iframeSrc reduced to origin.
    expect(result.iframeSrc).toBe("https://note.syrin.online/…");

    const joined = result.lines.map((l: { msg: string }) => l.msg).join("\n");
    expect(joined).not.toContain("my-secret-note-slug");
    expect(joined).not.toContain("alice@example.com");
    expect(joined).not.toContain("eyJabc.def.ghiJKLmnopQRStuv");
    expect(joined).not.toContain("/Users/alice");
    expect(joined).not.toContain("sk_live_ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(joined).not.toContain("11111111-2222-3333-4444-555555555555");
    expect(joined).not.toContain("token=xyz");
    expect(result.lines.map((line: { msg: string }) => line.msg)).toEqual([
      "ack sent",
      "loading",
      "debug-event",
      "debug-event",
    ]);
  });

  test("schema validates both redacted and non-redacted exports", async ({
    context,
    extensionId,
  }) => {
    const page = context.pages().find((p) => p.url().includes(extensionId))!;
    const out = await page.evaluate(async () => {
      const redactModule = "./lib/redact.js";
      const exportSchemaModule = "./lib/export-schema.js";
      const { redactPayload } = await import(redactModule);
      const { validateExport, expectedFilename, isExpectedFilename } = await import(
        exportSchemaModule
      );
      const ts = "2026-06-21T12:34:56.789Z";
      const raw = {
        kind: "syrin-note-debug-log",
        version: 1,
        extensionVersion: "1.3.0",
        exportedAt: ts,
        lastSlug: "abc",
        iframeSrc: "https://note.syrin.online/",
        redacted: false,
        lines: [{ t: 1, msg: "hello" }],
      };
      const red = redactPayload(raw);
      return {
        rawVerdict: validateExport(raw),
        redVerdict: validateExport(red),
        rawName: expectedFilename({ redacted: false, isoTimestamp: ts }),
        redName: expectedFilename({ redacted: true, isoTimestamp: ts }),
        rawNameOk: isExpectedFilename(expectedFilename({ redacted: false, isoTimestamp: ts })),
        redNameOk: isExpectedFilename(expectedFilename({ redacted: true, isoTimestamp: ts })),
        // Negative cases.
        missing: validateExport({ kind: "syrin-note-debug-log", version: 1 }),
        wrongKind: validateExport({ ...raw, kind: "other" }),
      };
    });

    expect(out.rawVerdict.ok).toBe(true);
    expect(out.redVerdict.ok).toBe(true);
    expect(out.rawName).toBe("syrin-note-debug-2026-06-21T12-34-56-789Z.json");
    expect(out.redName).toBe("syrin-note-debug-redacted-2026-06-21T12-34-56-789Z.json");
    expect(out.rawNameOk).toBe(true);
    expect(out.redNameOk).toBe(true);
    expect(out.missing.ok).toBe(false);
    expect(out.wrongKind.ok).toBe(false);
  });
});
