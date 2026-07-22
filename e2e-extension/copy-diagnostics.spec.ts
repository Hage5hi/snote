import { test, expect, openPanel, sendReady, waitForFallback } from "./fixtures/extension";
import { readFileSync } from "node:fs";

// Clicking "Download diagnostics JSON" in the fallback overlay must produce
// a schema-valid, sanitized bundle. Uses a known fixture (protocol=999,
// buildId="fixture-bad", appVersion="9.9.9") so we can pin exact values in
// the mismatch reason and handshake block.

const FIXTURE = { protocol: 999, buildId: "fixture-bad", appVersion: "9.9.9" };

// Keys that must never appear anywhere in the bundle.
const FORBIDDEN_KEYS = [
  "slug", "lastSlug", "noteBody", "content", "userEmail",
  "authToken", "accessToken", "password", "sessionId",
];

// Full allowed top-level key set (any extra key is a leak vector).
const ALLOWED_TOP_KEYS = new Set([
  "kind", "schemaVersion", "at", "extensionVersion",
  "handshake", "load", "cspFrameAncestors",
  "messageTimeline", "telemetry", "telemetryEnabled", "debugLines",
]);

test("Download diagnostics JSON contains only sanitized keys with fixture-pinned values", async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  await sendReady(panel, FIXTURE);
  await waitForFallback(panel);
  await panel.locator("details.diag > summary").click();
  await expect(panel.locator("#diag-download")).toBeVisible();

  const [download] = await Promise.all([
    panel.waitForEvent("download"),
    panel.locator("#diag-download").click(),
  ]);

  // Filename must be: syrin-note-diagnostics-<reasonType>-<isoTs>.json
  // For this fixture (protocol=999) reasonType is "mismatch". Timestamp
  // segment: 4-digit year, dashes replacing `:` and `.`, ending in Z.
  expect(download.suggestedFilename()).toMatch(
    /^syrin-note-diagnostics-mismatch-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/,
  );
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const bundle = JSON.parse(readFileSync(filePath!, "utf8"));

  // Top-level shape — every key present, no extras.
  const actualKeys = Object.keys(bundle).sort();
  const allowed = [...ALLOWED_TOP_KEYS].sort();
  expect(actualKeys).toEqual(allowed);

  // Fixture-pinned values.
  expect(bundle.kind).toBe("syrin-note-sidepanel-diagnostics");
  expect(bundle.schemaVersion).toBe(2);
  expect(bundle.handshake.extensionProtocol).toBe(2);
  expect(bundle.handshake.appProtocol).toBe(999);
  expect(bundle.handshake.appBuildId).toBe("<redacted>");
  expect(bundle.handshake.ready).toBe(false);
  expect(bundle.handshake.versionMismatch).toBe("protocol-mismatch");

  // Sanitization: no forbidden key names anywhere.
  const flat = JSON.stringify(bundle);
  for (const f of FORBIDDEN_KEYS) {
    expect(flat, `bundle leaked forbidden key: ${f}`).not.toMatch(
      new RegExp(`"${f}"\\s*:`),
    );
  }
});
