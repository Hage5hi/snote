// E2E: browser back/forward across a Split view session should preserve the
// last-split-view sessionStorage snapshot and restore the correct URL.
import { test, expect } from "@playwright/test";
import { seedVersionedPlaintextNote, deleteNote } from "./helpers/seed-note";

test("Split view session survives back/forward navigation", async ({ page }) => {
  const slugs = await Promise.all(
    Array.from({ length: 3 }, (_, i) => seedVersionedPlaintextNote(`nav-${i}`, `nav-pane-${i}`)),
  );
  const path = `/${slugs.join("+")}`;
  try {
    await page.goto(path);
    await page.getByRole("link", { name: /home|back to home/i }).first().waitFor({ state: "visible" });

    // Navigate away then back.
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.goBack();
    await page.waitForLoadState("domcontentloaded");
    expect(new URL(page.url()).pathname).toBe(path);
    await page.getByRole("link", { name: /home|back to home/i }).first().waitFor({ state: "visible" });

    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("snote:last-split-view:v1"),
    );
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.path).toBe(path);
    expect(parsed.slugs).toEqual(slugs);

    await page.goForward();
    await page.waitForLoadState("domcontentloaded");
    expect(new URL(page.url()).pathname).toBe("/");
  } finally {
    await Promise.all(slugs.map((s) => deleteNote(s)));
  }
});
