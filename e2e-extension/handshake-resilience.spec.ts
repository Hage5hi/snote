import { test, expect } from "./fixtures/extension";

// Resilience scenarios: slow first paint, no app response (offline/stale
// SW), and version-mismatched handshake. Assert the panel always reaches
// either ready or a diagnostics-rich fallback — never a silent hang.

const APP_ORIGIN = "https://note.syrin.online";

function dispatchReady(protocol: number, buildId = "test-build") {
  return {
    fn: (args: { origin: string; protocol: number; buildId: string }) => {
      const ev = new MessageEvent("message", {
        data: { type: "syrin:ready", protocol: args.protocol, buildId: args.buildId },
      });
      Object.defineProperty(ev, "origin", { value: args.origin });
      window.dispatchEvent(ev);
    },
    args: { origin: APP_ORIGIN, protocol, buildId },
  };
}

test("slow first paint: late ready still hides fallback", async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Simulate a slow app: wait 2s then post ready.
  await panel.waitForTimeout(2000);
  const d = dispatchReady(2);
  await panel.evaluate(d.fn, d.args);

  await expect(panel.locator("#fallback")).toBeHidden();
});

test("offline / stale SW: fallback exposes diagnostics after watchdog + retry", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Never post ready. Wait for the natural 12s watchdog + 12s retry.
  await panel.locator("#fallback").waitFor({ state: "visible", timeout: 30_000 });

  await expect(panel.locator("#diag-url")).toContainText(APP_ORIGIN);
  await expect(panel.locator("#diag-ready")).toHaveText(/not received|mismatch/);
  await expect(panel.locator("#diag-retries")).toHaveText(/^[12]$/);
  await expect(panel.locator("#diag-download")).toBeVisible();
});

test("version mismatch: unsupported app protocol triggers fallback with reason", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Post a protocol version outside the supported range.
  const d = dispatchReady(999);
  await panel.evaluate(d.fn, d.args);

  await panel.locator("#fallback").waitFor({ state: "visible", timeout: 5_000 });
  await expect(panel.locator("#diag-ready")).toHaveText(/mismatch/);
  await expect(panel.locator("#diag-ready")).toContainText("999");
});
