// E2E: navigate between 2 → 3 → 4 slug Split view URLs and verify each
// pane renders the expected note content and only one Home control exists.
import { test, expect } from "@playwright/test";
import { seedVersionedPlaintextNote, deleteNote } from "./helpers/seed-note";

test("Split view updates panes and selection when switching between 2/3/4 slugs", async ({ page }) => {
  const slugs = await Promise.all(
    Array.from({ length: 4 }, (_, i) => seedVersionedPlaintextNote(`switch-${i}`, `switch-pane-${i}`)),
  );
  try {
    for (const count of [2, 3, 4] as const) {
      const picked = slugs.slice(0, count);
      await page.goto(`/${picked.join("+")}`);
      const homeLinks = page.getByRole("link", { name: /home|back to home/i });
      await homeLinks.first().waitFor({ state: "visible" });
      await expect(homeLinks).toHaveCount(1);
      for (const s of picked) {
        await expect(page.getByText(`/${s}`, { exact: true }).first()).toBeVisible();
      }
      const stored = await page.evaluate(() =>
        window.sessionStorage.getItem("snote:last-split-view:v1"),
      );
      expect(JSON.parse(stored!).count).toBe(count);
    }
  } finally {
    await Promise.all(slugs.map((s) => deleteNote(s)));
  }
});
