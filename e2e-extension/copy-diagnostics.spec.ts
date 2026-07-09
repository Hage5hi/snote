import { test, expect } from "./fixtures/extension";
import { readFileSync } from "node:fs";

// Clicking "Download diagnostics JSON" in the fallback overlay must produce
// a schema-valid bundle containing the expected sanitized keys (no slugs,
// no note contents, no PII). This spec drives the fallback to the
// version-mismatch state (deterministic, no watchdog wait) and verifies
// the downloaded JSON.

const APP_ORIGIN = "https://note.syrin.online";

test("Download diagnostics JSON produces schema-valid sanitized bundle", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Force fallback deterministically via version mismatch (protocol=999).
  await panel.evaluate((origin) => {
    const ev = new MessageEvent("message", {
      data: { type: "syrin:ready", protocol: 999, buildId: "bad", appVersion: "test" },
    });
    Object.defineProperty(ev, "origin", { value: origin });
    window.dispatchEvent(ev);
  }, APP_ORIGIN);

  await expect(panel.locator("#fallback")).toBeVisible();
  await expect(panel.locator("#diag-download")).toBeVisible();

  const [download] = await Promise.all([
    panel.waitForEvent("download"),
    panel.locator("#diag-download").click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^syrin-note-diagnostics-.*\.json$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const raw = readFileSync(filePath!, "utf8");
  const bundle = JSON.parse(raw);

  // Required top-level keys.
  const expectedKeys = [
    "kind", "schemaVersion", "at", "extensionVersion",
    "handshake", "load", "cspFrameAncestors",
    "messageTimeline", "telemetry", "telemetryEnabled", "debugLines",
  ];
  for (const k of expectedKeys) expect(bundle, `missing key ${k}`).toHaveProperty(k);

  expect(bundle.kind).toBe("syrin-note-sidepanel-diagnostics");
  expect(bundle.schemaVersion).toBe(1);
  expect(bundle.handshake.extensionProtocol).toBe(2);
  expect(bundle.handshake.versionMismatch).toMatch(/app protocol=999/);

  // Sanitization: no slug/note payload keys should ever appear.
  const forbidden = ["slug", "noteBody", "content", "userEmail", "authToken"];
  const flat = JSON.stringify(bundle);
  for (const f of forbidden) {
    expect(flat, `bundle leaked forbidden key: ${f}`).not.toMatch(
      new RegExp(`"${f}"\\s*:`),
    );
  }
});
