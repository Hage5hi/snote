// Split view: layout, single Home control, and right-click-in-new-tab
// behaviour verified across 2/3/4 slug counts.
//
// Covers:
//   1. Each pane renders the correct seeded note content.
//   2. Only ONE top-level "Home" link exists (per-note Home arrow removed by
//      the `hideHome` prop in TopbarBrand when embedded via SplitView).
//   3. Right-clicking that single Home link opens `/` in a new browser tab
//      for every slug count.

import { test, expect, type Page } from "@playwright/test";
import { seedVersionedPlaintextNote, deleteNote } from "./helpers/seed-note";

const COUNTS = [2, 3, 4] as const;

async function seedN(count: number): Promise<string[]> {
  const slugs: string[] = [];
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop
    slugs.push(await seedVersionedPlaintextNote(`split${count}-${i}`, `pane-${i}-content-${count}`));
  }
  return slugs;
}

async function cleanup(slugs: string[]) {
  await Promise.all(slugs.map((s) => deleteNote(s)));
}

async function homeLinks(page: Page) {
  return page.getByRole("link", {
    name: /home|trang chủ|首页|ホーム|홈|accueil|inicio|start|início|back to home/i,
  });
}

for (const count of COUNTS) {
  test(`SplitView with ${count} slugs: layout, single Home, right-click opens new tab`, async ({
    context,
    page,
  }) => {
    const slugs = await seedN(count);
    try {
      await page.goto(`/${slugs.join("+")}`);

      // Wait for header Home link to render.
      const links = await homeLinks(page);
      await links.first().waitFor({ state: "visible" });

      // 3) Exactly ONE Home control visible (per-pane arrow is hidden).
      await expect(links).toHaveCount(1);

      // 1) Every seeded slug appears somewhere as a slug button (/slug label
      //    is rendered in each embedded Topbar plus once in the header).
      for (const s of slugs) {
        await expect(page.getByText(`/${s}`, { exact: true }).first()).toBeVisible();
      }

      // 2) Right-click Home → opens "/" in new tab, keeps original URL.
      const popupPromise = context.waitForEvent("page");
      await links.first().dispatchEvent("contextmenu");
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      expect(new URL(popup.url()).pathname).toBe("/");
      expect(new URL(page.url()).pathname).toBe(`/${slugs.join("+")}`);
      await popup.close();

      // 4) sessionStorage persistence records the current split path.
      const stored = await page.evaluate(() =>
        window.sessionStorage.getItem("snote:last-split-view:v1"),
      );
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.count).toBe(count);
      expect(parsed.path).toBe(`/${slugs.join("+")}`);
      expect(parsed.slugs).toEqual(slugs);
    } finally {
      await cleanup(slugs);
    }
  });
}
