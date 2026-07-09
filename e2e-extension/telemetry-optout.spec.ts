import { test, expect } from "./fixtures/extension";

// Verifies the telemetry opt-out toggle:
//  1. When disabled, no events are recorded even across rapid panel reopens.
//  2. Setting persists across page reloads and the diagnostics UI reflects it.
//  3. Re-enabling starts recording again.

const APP_ORIGIN = "https://note.syrin.online";
const ENABLED_KEY = "syrin:telemetryEnabled";
const EVENTS_KEY = "syrin:telemetry";

async function setTelemetry(sw: import("@playwright/test").Worker, enabled: boolean) {
  await sw.evaluate(
    ([key, val]) =>
      new Promise<void>((resolve) => {
        // @ts-expect-error chrome global in SW
        chrome.storage.local.set({ [key]: val }, () => resolve());
      }),
    [ENABLED_KEY, enabled] as const,
  );
}

async function readEvents(sw: import("@playwright/test").Worker): Promise<unknown[]> {
  return sw.evaluate(
    (key) =>
      new Promise((resolve) => {
        // @ts-expect-error chrome global in SW
        chrome.storage.local.get({ [key]: [] }, (s) => resolve(s[key] ?? []));
      }),
    EVENTS_KEY,
  );
}

async function clearAll(sw: import("@playwright/test").Worker) {
  await sw.evaluate(
    (key) =>
      new Promise<void>((resolve) => {
        // @ts-expect-error chrome global in SW
        chrome.storage.local.remove(key, () => resolve());
      }),
    EVENTS_KEY,
  );
}

async function postBadProtocol(page: import("@playwright/test").Page) {
  // Triggers a handshake-version-mismatch telemetry event (would-be recorded).
  await page.evaluate((origin) => {
    const ev = new MessageEvent("message", {
      data: { type: "syrin:ready", protocol: 999, buildId: "x", appVersion: "test" },
    });
    Object.defineProperty(ev, "origin", { value: origin });
    window.dispatchEvent(ev);
  }, APP_ORIGIN);
}

test("opt-out: no telemetry recorded across rapid panel reopen", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await setTelemetry(serviceWorker, false);
  await clearAll(serviceWorker);

  for (let i = 0; i < 3; i++) {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await postBadProtocol(panel);
    await panel.close();
  }

  const events = await readEvents(serviceWorker);
  expect(events).toEqual([]);
});

test("re-enable: telemetry resumes recording", async ({ context, extensionId, serviceWorker }) => {
  await setTelemetry(serviceWorker, true);
  await clearAll(serviceWorker);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await postBadProtocol(panel);
  // Give the storage write a beat to flush.
  await panel.waitForTimeout(200);
  const events = await readEvents(serviceWorker);
  expect(events.length).toBeGreaterThan(0);
  await panel.close();
});

test("persistence: opt-out survives options-page reload; diagnostics UI reflects status", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // Toggle off via the options page (source of truth for user intent).
  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extensionId}/options.html`);
  const telemetry = opts.locator("#telemetryEnabled");
  await telemetry.uncheck();
  await opts.locator("#save").click();
  await expect(opts.locator("#status")).toHaveText("✓ Saved");

  // Reload — should stay unchecked (persisted across "restart").
  await opts.reload();
  await expect(opts.locator("#telemetryEnabled")).not.toBeChecked();
  await opts.close();

  // Diagnostics UI: force the fallback and check the telemetry status label.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await postBadProtocol(panel); // triggers fallback via version mismatch
  await expect(panel.locator("#fallback")).toBeVisible();
  await expect(panel.locator("#diag-telemetry-status")).toHaveText(/off/);

  // And no events recorded because we're opted out.
  const events = await readEvents(serviceWorker);
  expect(events).toEqual([]);
});
