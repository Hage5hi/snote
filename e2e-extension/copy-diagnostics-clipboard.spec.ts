import { test, expect, openPanel, sendReady, waitForFallback } from "./fixtures/extension";

// Clicking the prominent "Copy diagnostics" button on the fallback overlay
// must copy a JSON payload to the clipboard that passes the same schema
// validation the download path enforces. Uses the extension origin so
// clipboard-read permission can be granted (chrome-extension:// URLs
// accept it directly).

test("Copy diagnostics puts schema-valid JSON on the clipboard", async ({
  context,
  extensionId,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: `chrome-extension://${extensionId}`,
  });

  const panel = await openPanel(context, extensionId);
  await sendReady(panel, { protocol: 999, buildId: "copy-fixture" });
  await waitForFallback(panel);

  await panel.locator("#fallback-copy-diag").click();

  // Poll clipboard until the async bundle build completes.
  const text = await panel.waitForFunction(
    async () => {
      const t = await navigator.clipboard.readText();
      return t && t.startsWith("{") ? t : null;
    },
    null,
    { timeout: 5_000 },
  );
  const raw = await text.jsonValue() as string;
  const bundle = JSON.parse(raw);

  // Required-schema validation rules (mirror lib/diagnostics-schema.js).
  const required = [
    "kind", "schemaVersion", "at", "extensionVersion",
    "handshake", "load", "cspFrameAncestors",
    "messageTimeline", "telemetry", "telemetryEnabled", "debugLines",
  ];
  for (const k of required) expect(bundle, `missing ${k}`).toHaveProperty(k);

  expect(bundle.kind).toBe("syrin-note-sidepanel-diagnostics");
  expect(bundle.schemaVersion).toBe(2);
  expect(typeof bundle.extensionVersion).toBe("string");
  expect(Number.isNaN(Date.parse(bundle.at))).toBe(false);
  expect(typeof bundle.handshake.extensionProtocol).toBe("number");
  expect(typeof bundle.handshake.ready).toBe("boolean");
  expect(typeof bundle.load.iframeSrc).toBe("string");
  expect(typeof bundle.load.iframeLoaded).toBe("boolean");
  expect(typeof bundle.load.retryCount).toBe("number");
  expect(Array.isArray(bundle.messageTimeline)).toBe(true);
  expect(Array.isArray(bundle.telemetry)).toBe(true);
  expect(typeof bundle.telemetryEnabled).toBe("boolean");
  expect(Array.isArray(bundle.debugLines)).toBe(true);

  // Fixture values from the mismatch we triggered.
  expect(bundle.handshake.appProtocol).toBe(999);
  expect(bundle.handshake.appBuildId).toBe("copy-fixture");

  // Validation error banner must NOT be visible when schema is valid.
  await expect(panel.locator("#diag-validation")).toBeHidden();
});
