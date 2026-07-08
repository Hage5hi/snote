// E2E: Split view remains functional and does NOT select the wrong note when
// sessionStorage contains a malformed / partial `snote:last-split-view:v1`
// payload. The URL is the source of truth; bad persistence must be ignored.
import { test, expect } from "@playwright/test";

const cases = [
  { label: "malformed JSON", value: "{not json" },
  { label: "missing path", value: JSON.stringify({ slugs: ["a", "b"], count: 2, savedAt: 0 }) },
  { label: "invalid slug count", value: JSON.stringify({ path: "/a", slugs: ["a"], count: 1, savedAt: 0 }) },
];

for (const c of cases) {
  test(`Split view renders correctly when persisted payload is ${c.label}`, async ({ page }) => {
    await page.addInitScript((raw) => {
      try {
        sessionStorage.setItem("snote:last-split-view:v1", raw);
      } catch {
        /* ignore */
      }
    }, c.value);

    await page.goto("/foo+bar");
    // Page must render both panes derived from the URL, not from bad storage.
    await expect(page).toHaveURL(/\/foo\+bar$/);
    const panes = page.locator("[data-split-view-pane]");
    await expect(panes).toHaveCount(2, { timeout: 5_000 });
  });
}
