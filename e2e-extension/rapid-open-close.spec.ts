import { test, expect } from "./fixtures/extension";

// Simulates rapid panel open/close cycles and multiple simultaneous
// syrin:ready handshakes (as can happen when the app auto-reloads during
// a PWA update while the user is toggling the panel). The panel must
// converge to a consistent state — either ready (fallback hidden) or
// a fallback with a coherent mismatch reason — never a half-open UI.

const APP_ORIGIN = "https://note.syrin.online";

async function postReady(page: import("@playwright/test").Page, protocol: number, buildId: string) {
  await page.evaluate(
    ({ origin, protocol, buildId }) => {
      const ev = new MessageEvent("message", {
        data: { type: "syrin:ready", protocol, buildId, appVersion: "test" },
      });
      Object.defineProperty(ev, "origin", { value: origin });
      window.dispatchEvent(ev);
    },
    { origin: APP_ORIGIN, protocol, buildId },
  );
}

test("rapid open/close: each cycle reaches ready or fallback deterministically", async ({
  context,
  extensionId,
}) => {
  for (let i = 0; i < 3; i++) {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    // Send ready quickly so the panel converges before we close it.
    await postReady(panel, 2, `build-${i}`);
    await expect(panel.locator("#fallback")).toBeHidden();
    await expect(panel.locator("#loader")).toHaveClass(/hidden/);
    await panel.close();
  }
});

test("simultaneous handshakes: multiple ready messages leave panel in ready state", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Fire several ready messages in rapid succession — mimics a PWA
  // update where the app remounts and re-broadcasts ready.
  await Promise.all([
    postReady(panel, 2, "build-a"),
    postReady(panel, 2, "build-b"),
    postReady(panel, 2, "build-c"),
  ]);

  await expect(panel.locator("#fallback")).toBeHidden();
  // A subsequent stray ready must not flip the panel back into fallback.
  await postReady(panel, 2, "build-d");
  await expect(panel.locator("#fallback")).toBeHidden();
});

test("simultaneous ready + version-mismatch: first-wins keeps panel consistent", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // A valid ready arrives first, then a stray bad-protocol message.
  // Panel should stay ready — the first handshake wins and later stray
  // messages must not corrupt state.
  await postReady(panel, 2, "build-ok");
  await postReady(panel, 999, "build-bad");
  await expect(panel.locator("#fallback")).toBeHidden();
});
