// E2E: responsive layout visual regression for the InstallPrompt panel.
//
// At 360 / 640 / 1024 viewports we assert:
//   - The panel and the document body have no horizontal overflow.
//   - <640 collapses to 1 grid column; >=640 renders 2 equal columns.
//   - In 2-column mode, both trigger buttons share the same offsetTop
//     (alignment guard against vertical misalignment).
//   - A per-viewport screenshot diff baseline is stored under
//     e2e/__screenshots__/install-prompt-responsive.spec.ts/ on first run.
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile-360", width: 360, height: 800, cols: 1 },
  { name: "sm-640", width: 640, height: 900, cols: 2 },
  { name: "desktop-1024", width: 1024, height: 900, cols: 2 },
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

for (const vp of VIEWPORTS) {
  test(`install panel responsive @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    const panel = page.getByTestId("install-prompt");
    await expect(panel).toBeVisible();
    await panel.scrollIntoViewIfNeeded();

    // No horizontal overflow on the panel or on the document.
    const overflow = await page.evaluate(() => {
      const html = document.documentElement;
      const el = document.querySelector(
        '[data-testid="install-prompt"]',
      ) as HTMLElement;
      return {
        panelScroll: el.scrollWidth,
        panelClient: el.clientWidth,
        docScroll: html.scrollWidth,
        docClient: html.clientWidth,
      };
    });
    expect(overflow.panelScroll, "panel x-overflow").toBeLessThanOrEqual(
      overflow.panelClient,
    );
    expect(overflow.docScroll, "document x-overflow").toBeLessThanOrEqual(
      overflow.docClient,
    );

    // Grid column count matches the breakpoint.
    const tracks = await panel.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return cs.gridTemplateColumns.trim().split(/\s+/).length;
    });
    expect(tracks).toBe(vp.cols);

    // In 2-column mode the two trigger buttons must align on the same row.
    // Direct children of the panel are the two Radix DialogTrigger buttons.
    if (vp.cols === 2) {
      const tops = await panel.evaluate((el) => {
        const btns = Array.from(el.children).filter(
          (c) => c.tagName === "BUTTON",
        ) as HTMLElement[];
        return btns.map((b) => b.getBoundingClientRect().top);
      });
      expect(tops.length).toBe(2);
      expect(Math.abs(tops[0] - tops[1])).toBeLessThanOrEqual(1);
    }

    // Visual regression — panel-only screenshot per viewport.
    await expect(panel).toHaveScreenshot(`install-prompt-${vp.name}.png`, {
      maxDiffPixelRatio: 0.02,
    });
  });
}
