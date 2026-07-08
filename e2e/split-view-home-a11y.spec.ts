// E2E accessibility: in Split view, there must be exactly one focusable
// "Back to home" control, with an accessible name and reachable via keyboard.
import { test, expect } from "@playwright/test";
import { seedVersionedPlaintextNote, deleteNote } from "./helpers/seed-note";

test("Split view: single accessible Home control, focusable via keyboard", async ({ page }) => {
  const slugs = await Promise.all(
    Array.from({ length: 3 }, (_, i) => seedVersionedPlaintextNote(`a11y-${i}`, `a11y-${i}`)),
  );
  try {
    await page.goto(`/${slugs.join("+")}`);
    const links = page.getByRole("link", { name: /home|back to home/i });
    await links.first().waitFor({ state: "visible" });
    await expect(links).toHaveCount(1);

    const link = links.first();
    await expect(link).toHaveAttribute("aria-label", /home/i);
    await link.focus();
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? null,
    );
    expect(focused).toMatch(/home/i);
  } finally {
    await Promise.all(slugs.map((s) => deleteNote(s)));
  }
});
