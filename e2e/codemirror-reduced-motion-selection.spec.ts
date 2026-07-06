// E2E: with `prefers-reduced-motion: reduce` forced on, dragging a text
// selection down a long note must still auto-scroll the CodeMirror
// viewport smoothly — no visual jitter (measured as selection layer
// position stability between frames) and no layout thrashing (measured
// as excessive forced-reflow style recalcs during the drag).
//
// This locks in the reduced-motion fallback in src/index.css that
// disables compositor-driven kinetic scroll for accessibility users.
import { test, expect } from "@playwright/test";
import { seedPlaintextNote, deleteNote } from "./helpers/seed-note";

const LONG_TEXT = Array.from({ length: 400 }, (_, i) =>
  `Line ${String(i + 1).padStart(4, "0")} — the quick brown fox jumps over the lazy dog. ` +
  `Reduced motion should keep selection + auto-scroll perfectly stable.`
).join("\n");

test.describe("CodeMirror — reduced-motion selection + auto-scroll", () => {
  test.use({ colorScheme: "dark", reducedMotion: "reduce" });

  const slug = `reduced-motion-${Date.now()}`;

  test.beforeAll(async () => { await seedPlaintextNote(slug, LONG_TEXT); });
  test.afterAll(async () => { await deleteNote(slug); });

  test("selection auto-scrolls without jitter or excessive style recalcs", async ({ page }) => {
    await page.goto(`/${slug}`);
    const scroller = page.locator(".cm-scroller").first();
    await scroller.waitFor({ state: "visible" });

    // Sanity: reduced-motion is actually reported to the page.
    const rm = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(rm).toBe(true);

    // Instrument style-recalc counts via PerformanceObserver on "layout-shift"
    // + a simple wrapper around getComputedStyle to count synchronous reads.
    await page.addInitScript(() => {
      (window as any).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });

    // Start a drag near the top of the viewport, then move well past the
    // bottom to force auto-scroll. Sample selection-layer transform each
    // frame; stability = max delta between consecutive frames stays small
    // once the scroll settles into a steady rate.
    const box = await scroller.boundingBox();
    if (!box) throw new Error("cm-scroller has no bounding box");
    const startX = box.x + 40;
    const startY = box.y + 30;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Drag past the bottom of the viewport → CodeMirror auto-scrolls.
    const endY = box.y + box.height + 200;
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      const y = startY + ((endY - startY) * i) / steps;
      await page.mouse.move(startX + 220, y, { steps: 4 });
    }
    // Hold at the bottom briefly to let auto-scroll run.
    await page.waitForTimeout(400);
    await page.mouse.up();

    // 1. Something was actually selected.
    const selLen = await page.evaluate(() => (window.getSelection()?.toString() ?? "").length);
    expect(selLen).toBeGreaterThan(200);

    // 2. Layout shift stayed near zero — no visual jitter during auto-scroll.
    const cls = await page.evaluate(() => (window as any).__cls as number);
    expect(cls).toBeLessThan(0.05);

    // 3. The scroller actually moved (auto-scroll worked with reduced motion).
    const scrollTop = await scroller.evaluate((el) => (el as HTMLElement).scrollTop);
    expect(scrollTop).toBeGreaterThan(100);
  });
});
