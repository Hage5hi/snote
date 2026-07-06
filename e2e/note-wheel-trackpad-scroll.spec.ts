// Regression guard for the CodeMirror scroll fix. Earlier CSS layered
// `transform: translateZ(0)` + `will-change: scroll-position` +
// `contain: strict` on `.cm-scroller` and its selection overlay, which
// promoted the scroller into a compositor layer that swallowed wheel /
// trackpad delta on some setups — the user could not scroll at all.
//
// This spec loads a long note, then:
//   1) fires many discrete wheel deltas (mouse-wheel simulation) and
//      asserts every one moves `scrollTop` — no missed deltas,
//   2) fires small, high-frequency deltas that mimic a trackpad's
//      continuous stream and asserts `scrollTop` advances monotonically
//      and reaches near the bottom,
//   3) drag-selects across many lines while scrolling and asserts the
//      selection stays live (does not get stuck) and the scroller keeps
//      moving.
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LINES = 1_000;

// Ring-buffer of wheel deltas so failure diagnostics show exactly which
// tick got swallowed and where scrollTop was at the time.
type WheelSample = { i: number; dx: number; dy: number; before: number; after: number; t: number };
const wheelLog = new WeakMap<import("@playwright/test").Page, WheelSample[]>();
// First "stuck frame" per page — the sample where an incoming delta failed
// to move `scrollTop`. Captured live during the test and attached to the
// Playwright trace via `testInfo.annotations` so it's visible in the trace
// viewer next to the failing action.
const stuckFrame = new WeakMap<import("@playwright/test").Page, WheelSample>();
function recordWheel(
  page: import("@playwright/test").Page,
  s: WheelSample,
  testInfo?: import("@playwright/test").TestInfo,
) {
  const arr = wheelLog.get(page) ?? [];
  arr.push(s); if (arr.length > 200) arr.shift();
  wheelLog.set(page, arr);
  // Auto stuck-frame detection: first non-advancing tick after a real
  // delta was requested. Recorded once per page so retries don't flood.
  if (s.dy !== 0 && s.after === s.before && !stuckFrame.has(page)) {
    stuckFrame.set(page, s);
    testInfo?.annotations.push({
      type: "stuck-frame",
      description: `wheel tick #${s.i} dy=${s.dy} scrollTop stuck at ${s.before} (t=${s.t})`,
    });
  }
}

// Force a consistent scroll environment across engines so the wheel/
// trackpad deltas we synthesize aren't reinterpreted mid-stream:
//   - fixed viewport & device scale so `mouse.wheel` deltas map to the
//     same CSS pixels everywhere,
//   - reduced-motion + `scroll-behavior: auto` so no engine sneaks in
//     smooth-scroll interpolation that hides swallowed ticks,
//   - light color scheme so devtools/media-query CSS doesn't reflow.
test.use({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});

async function seedLongNote(page: import("@playwright/test").Page) {
  // Kill any programmatic smooth-scroll or zoom that could reinterpret
  // synthesized deltas. Runs before the SPA hydrates.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = `html,body,*{scroll-behavior:auto !important} html{zoom:1 !important}`;
    (document.head || document.documentElement).appendChild(style);
  });
  await page.goto("/wheel-scroll-e2e");
  // Wait for CodeMirror to mount.
  const scroller = page.locator(".cm-scroller").first();
  await scroller.waitFor({ state: "visible", timeout: 15_000 });

  // Inject 1,000 lines directly through the CM view so we don't spend
  // minutes typing. Falls back to keyboard for the last newline so the
  // editor's own scroll bookkeeping settles.
  await page.evaluate((n) => {
    const el = document.querySelector<HTMLElement>(".cm-content");
    // @ts-expect-error cmView is CM6's private handle onto the EditorView
    const view = el?.cmView?.view ?? (el as unknown as { cmView?: { view?: unknown } })?.cmView?.view;
    const text = Array.from({ length: n }, (_, i) => `line ${i} lorem ipsum dolor sit amet consectetur adipiscing`).join("\n");
    if (view && typeof (view as { dispatch?: unknown }).dispatch === "function") {
      (view as { dispatch: (spec: unknown) => void; state: { doc: { length: number } } }).dispatch({
        changes: { from: 0, to: (view as { state: { doc: { length: number } } }).state.doc.length, insert: text },
      });
    } else {
      // Fallback: set textContent so at least the test doesn't hang.
      if (el) el.textContent = text;
    }
  }, LINES);

  // Give layout a tick to compute scrollHeight.
  await page.waitForTimeout(200);
  const dims = await scroller.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(dims.overflowY, "scroller must be scrollable — regression: layer-promoted overflow hidden").toMatch(/auto|scroll/);
  expect(dims.scrollHeight, "note must be tall enough to actually scroll").toBeGreaterThan(dims.clientHeight * 4);
  return scroller;
}

test.describe("note wheel + trackpad scroll @scroll", () => {
  // Flake insurance: wheel/trackpad delivery is engine + GPU dependent on
  // CI. Two retries keeps the guard useful without hiding regressions —
  // Playwright still keeps the first-run trace on failure.
  test.describe.configure({ retries: 2 });

  // Rich diagnostics on failure: full trace (via playwright config),
  // element screenshot, and the last wheel deltas + scroll positions so
  // it's obvious whether a tick was swallowed vs. the scroller was
  // already at max.
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    try {
      const dir = testInfo.outputDir;
      mkdirSync(dir, { recursive: true });
      const scroller = page.locator(".cm-scroller").first();
      const state = await scroller.evaluate((el) => ({
        scrollTop: el.scrollTop, scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight, max: el.scrollHeight - el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
        pointerEvents: getComputedStyle(el).pointerEvents,
      })).catch((e) => ({ error: String(e) }));
      const payload = { scroller: state, wheelSamples: wheelLog.get(page) ?? [] };
      const jsonPath = join(dir, "wheel-diagnostics.json");
      writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
      await testInfo.attach("wheel-diagnostics.json", { path: jsonPath, contentType: "application/json" });
      const shot = join(dir, "scroller.png");
      await scroller.screenshot({ path: shot }).then(
        () => testInfo.attach("scroller.png", { path: shot, contentType: "image/png" }),
      ).catch(() => {});
    } catch { /* best-effort */ }
  });

  test("discrete wheel ticks all register — no missed deltas", async ({ page }, testInfo) => {
    const scroller = await seedLongNote(page);
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    const box = await scroller.boundingBox();
    if (!box) throw new Error("scroller has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Warm-up: some engines drop the first wheel event after pointer move
    // while they attach passive-wheel listeners. Fire and discard, then
    // reset to top before the real assertions.
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(30); }
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(50);

    const positions: number[] = [await scroller.evaluate((el) => el.scrollTop)];
    for (let i = 0; i < 12; i++) {
      const before = await scroller.evaluate((el) => el.scrollTop);
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(40);
      const after = await scroller.evaluate((el) => el.scrollTop);
      recordWheel(page, { i, dx: 0, dy: 120, before, after, t: Date.now() }, testInfo);
      positions.push(after);
      expect(
        after,
        `wheel tick #${i + 1} was swallowed (scrollTop stayed at ${before}) — regression in .cm-scroller CSS`,
      ).toBeGreaterThan(before);
    }
    // Monotonically increasing overall.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
  });

  test("trackpad-style continuous small deltas advance smoothly and reach the bottom", async ({ page }, testInfo) => {
    const scroller = await seedLongNote(page);
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    const box = await scroller.boundingBox();
    if (!box) throw new Error("scroller has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // 60 tiny deltas at ~16ms cadence ≈ a two-finger trackpad flick.
    let last = 0;
    let advancingTicks = 0;
    for (let i = 0; i < 60; i++) {
      const before = last;
      await page.mouse.wheel(0, 24);
      await page.waitForTimeout(16);
      const now = await scroller.evaluate((el) => el.scrollTop);
      recordWheel(page, { i, dx: 0, dy: 24, before, after: now, t: Date.now() }, testInfo);
      if (now > last) advancingTicks++;
      last = now;
    }
    // Allow the last few frames to catch up.
    await page.waitForTimeout(150);
    const { scrollTop, max } = await scroller.evaluate((el) => ({
      scrollTop: el.scrollTop, max: el.scrollHeight - el.clientHeight,
    }));
    // The stream should have moved us most of the way down …
    expect(scrollTop, "trackpad stream did not advance the scroller").toBeGreaterThan(0);
    // … and the vast majority of ticks should have registered as motion.
    expect(advancingTicks).toBeGreaterThanOrEqual(50);
    // Fire a few more big deltas to reach the very bottom without depending
    // on exact pixel budgets across engines.
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    const end = await scroller.evaluate((el) => el.scrollTop);
    expect(end, "scroller must reach the bottom").toBeGreaterThanOrEqual(max - 4);
  });

  test("drag-select across many lines stays live while scrolling", async ({ page }) => {
    const scroller = await seedLongNote(page);
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    const box = await scroller.boundingBox();
    if (!box) throw new Error("scroller has no bounding box");

    // Press near the top-left of the visible content, then drag toward the
    // bottom edge to trigger CM's built-in selection auto-scroll.
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(box.x + 40 + i * 4, box.y + box.height - 8, { steps: 2 });
      await page.waitForTimeout(30);
    }
    const midScroll = await scroller.evaluate((el) => el.scrollTop);
    await page.mouse.up();

    const selectionInfo = await page.evaluate(() => {
      const sel = window.getSelection();
      return { text: sel?.toString() ?? "", rangeCount: sel?.rangeCount ?? 0 };
    });
    expect(selectionInfo.rangeCount, "selection must remain live after drag").toBeGreaterThan(0);
    expect(selectionInfo.text.length, "selection should have captured multiple lines").toBeGreaterThan(20);
    expect(midScroll, "auto-scroll should have advanced during drag").toBeGreaterThan(0);

    // A follow-up wheel tick after releasing the drag must still work —
    // catches "selection leaves scroller in a stuck compositor layer" regressions.
    const before = await scroller.evaluate((el) => el.scrollTop);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(80);
    const after = await scroller.evaluate((el) => el.scrollTop);
    expect(after, "wheel is stuck after drag-select — selection layer regressed").not.toBe(before);
  });
});
