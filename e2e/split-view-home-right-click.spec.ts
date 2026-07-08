// E2E: right-click on the single "Back to home" arrow opens "/" in a new tab
// for every Split view slug count (2/3/4). Complements split-view-layouts by
// exercising a dedicated context-menu path across all counts in one spec.
import { test, expect } from "@playwright/test";
import { seedVersionedPlaintextNote, deleteNote } from "./helpers/seed-note";

for (const count of [2, 3, 4] as const) {
  test(`Right-click Home in Split view (${count} slugs) opens "/" in a new tab`, async ({
    context,
    page,
  }) => {
    const slugs = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        seedVersionedPlaintextNote(`rc-${count}-${i}`, `rc-${count}-${i}`),
      ),
    );
    const path = `/${slugs.join("+")}`;
    try {
      await page.goto(path);
      const link = page.getByRole("link", { name: /home|back to home/i }).first();
      await link.waitFor({ state: "visible" });

      const popupPromise = context.waitForEvent("page");
      await link.dispatchEvent("contextmenu");
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      expect(new URL(popup.url()).pathname).toBe("/");
      expect(new URL(page.url()).pathname).toBe(path);
      await popup.close();
    } finally {
      await Promise.all(slugs.map((s) => deleteNote(s)));
    }
  });
}
