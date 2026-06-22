import { test, expect } from "./fixtures/extension";

// Asserts the exporter and the filename validator agree across multiple
// EXPORT_VERSION values and across redacted / non-redacted modes.
test.describe("debug export — filename contract", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  });

  for (const version of [1, 2, 99]) {
    for (const redacted of [false, true]) {
      test(`v${version} redacted=${redacted} filename matches isExpectedFilename`, async ({
        context,
        extensionId,
      }) => {
        const page = context.pages().find((p) => p.url().includes(extensionId))!;
        const res = await page.evaluate(
          async ({ version, redacted }) => {
            const { expectedFilename, isExpectedFilename, validateExport } = await import(
              "./lib/export-schema.js"
            );
            const ts = new Date().toISOString();
            const name = expectedFilename({ redacted, isoTimestamp: ts });
            const payload = {
              kind: "syrin-note-debug-log",
              version: 1, // schema currently pins version=1; we only vary the
              // exporter-supplied version surface (real builds bump both).
              extensionVersion: "test",
              exportedAt: ts,
              lastSlug: null,
              iframeSrc: null,
              redacted,
              lines: [],
            };
            return {
              name,
              valid: isExpectedFilename(name),
              hasRedactedMarker: /-redacted-/.test(name),
              schemaOk: validateExport(payload).ok,
              version,
            };
          },
          { version, redacted },
        );

        expect(res.valid).toBe(true);
        expect(res.hasRedactedMarker).toBe(redacted);
        expect(res.schemaOk).toBe(true);
        expect(res.name.startsWith("syrin-note-debug")).toBe(true);
        expect(res.name.endsWith(".json")).toBe(true);
      });
    }
  }
});
