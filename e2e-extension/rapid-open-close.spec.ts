import {
  expect,
  openPanel,
  sendReady,
  test,
} from "./fixtures/extension";

// Simulates rapid panel open/close cycles and multiple simultaneous
// syrin:ready handshakes (as can happen when the app auto-reloads during
// a PWA update while the user is toggling the panel). The panel must
// converge to a consistent state — either ready (fallback hidden) or
// a fallback with a coherent mismatch reason — never a half-open UI.

test("rapid open/close: each cycle reaches ready or fallback deterministically", async ({
  context,
  extensionId,
}) => {
  for (let i = 0; i < 3; i++) {
    const panel = await openPanel(context, extensionId);
    // Send ready quickly so the panel converges before we close it.
    await sendReady(panel, { protocol: 2, buildId: `build-${i}` });
    await expect(panel.locator("#fallback")).toBeHidden();
    await expect(panel.locator("#loader")).toHaveClass(/hidden/);
    await panel.close();
  }
});

test("simultaneous handshakes: multiple ready messages leave panel in ready state", async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);

  // Fire several ready messages in rapid succession — mimics a PWA
  // update where the app remounts and re-broadcasts ready.
  await Promise.all([
    sendReady(panel, { protocol: 2, buildId: "build-a" }),
    sendReady(panel, { protocol: 2, buildId: "build-b" }),
    sendReady(panel, { protocol: 2, buildId: "build-c" }),
  ]);

  await expect(panel.locator("#fallback")).toBeHidden();
  // A subsequent stray ready must not flip the panel back into fallback.
  await sendReady(panel, { protocol: 2, buildId: "build-d" });
  await expect(panel.locator("#fallback")).toBeHidden();
});

test("simultaneous ready + version-mismatch: first-wins keeps panel consistent", async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);

  // A valid ready arrives first, then a stray bad-protocol message.
  // Panel should stay ready — the first handshake wins and later stray
  // messages must not corrupt state.
  await sendReady(panel, { protocol: 2, buildId: "build-ok" });
  await sendReady(panel, { protocol: 999, buildId: "build-bad" });
  await expect(panel.locator("#fallback")).toBeHidden();
});
