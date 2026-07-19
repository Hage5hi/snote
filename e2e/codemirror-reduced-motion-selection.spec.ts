// E2E: with `prefers-reduced-motion: reduce` forced on, dragging a text
// selection down a CodeMirror surface auto-scrolls smoothly across
// several note shapes:
//
//   • long note        — original 400-line stress case
//   • short note       — ~30 lines, ensures auto-scroll still no-ops cleanly
//   • code-block note  — mixed prose + fenced code, exercises the
//                        selection layer over CM's decoration ranges
//
// Each case asserts: something was selected, scrollTop advanced when
// expected, and CLS < 0.05 (no jitter/thrash). Per-test timing is
// annotated so CI reports pinpoint slow shapes.
//
// The suite is `describe.configure({ mode: "parallel" })` so it can
// interleave with other non-shared-state specs without flake.
import { test, expect, type Page } from "@playwright/test";
import { seedPlaintextNote, deleteNote } from "./helpers/seed-note";

const LONG = Array.from({ length: 400 }, (_, i) =>
  `Line ${String(i + 1).padStart(4, "0")} — reduced motion keeps selection stable.`
).join("\n");

const SHORT = Array.from({ length: 30 }, (_, i) =>
  `Line ${String(i + 1).padStart(2, "0")} — short note baseline.`
).join("\n");

const CODEY = [
  "# Notes with code",
  "",
  "Prose paragraph one — selection should sweep across decoration boundaries.",
  "",
  "```ts",
  ...Array.from({ length: 60 }, (_, i) => `const x${i} = ${i} * 2; // line ${i}`),
  "```",
  "",
  "Prose paragraph two.",
  "",
  "```js",
  ...Array.from({ length: 40 }, (_, i) => `function fn${i}(a, b) { return a + b + ${i}; }`),
  "```",
  "",
  ...Array.from({ length: 80 }, (_, i) => `Trailing prose line ${i} to give room for auto-scroll.`),
].join("\n");

type Shape = { name: string; text: string; expectScroll: boolean; minSelected: number };

const SHAPES: Shape[] = [
  { name: "long-note",       text: LONG,  expectScroll: true,  minSelected: 200 },
  { name: "short-note",      text: SHORT, expectScroll: false, minSelected: 40  },
  { name: "code-block-note", text: CODEY, expectScroll: true,  minSelected: 200 },
];

test.describe.configure({ mode: "parallel" });
test.describe("CodeMirror — reduced-motion selection + auto-scroll", () => {
  test.use({ colorScheme: "dark" });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const shape of SHAPES) {
    const slug = `reduced-motion-${shape.name}-${Date.now()}`;

    test.beforeAll(async () => { await seedPlaintextNote(slug, shape.text); });
    test.afterAll(async () => { await deleteNote(slug); });

    test(`stable selection on ${shape.name}`, async ({ page }, testInfo) => {
      const t0 = Date.now();
      await page.goto(`/${slug}`);
      const scroller = page.locator(".cm-scroller").first();
      await scroller.waitFor({ state: "visible" });

      expect(
        await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
      ).toBe(true);

      await page.addInitScript(() => {
        (window as any).__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      });

      const box = await scroller.boundingBox();
      if (!box) throw new Error("cm-scroller has no bounding box");
      const startX = box.x + 40, startY = box.y + 30;
      const endY   = box.y + box.height + 200;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        const y = startY + ((endY - startY) * i) / steps;
        await page.mouse.move(startX + 220, y, { steps: 4 });
      }
      await page.waitForTimeout(300);
      await page.mouse.up();

      const selLen = await page.evaluate(() => (window.getSelection()?.toString() ?? "").length);
      expect(selLen).toBeGreaterThan(shape.minSelected);

      const cls = await page.evaluate(() => (window as any).__cls as number);
      expect(cls).toBeLessThan(0.05);

      const scrollTop = await scroller.evaluate((el) => (el as HTMLElement).scrollTop);
      if (shape.expectScroll) expect(scrollTop).toBeGreaterThan(100);
      else expect(scrollTop).toBeLessThan(200); // short note may drift a hair

      // Per-test timing surfaces in Playwright's JSON/GitHub reporter.
      testInfo.annotations.push({
        type: "timing",
        description: `${shape.name}: total=${Date.now() - t0}ms, selected=${selLen}chars, cls=${cls.toFixed(4)}, scrollTop=${scrollTop}`,
      });
    });
  }
});
