// E2E stress: navigate rapidly through many rename/duplicate deep-link
// variants back-to-back. Each must land on a safe not-found state and
// never emit runtime errors.
import { test, expect, type ConsoleMessage } from "@playwright/test";

const variants = [
  "/note/a/rename",
  "/note/a/duplicate",
  "/note/b/rename?name=x",
  "/note/b/duplicate?target=y",
  "/note/c?action=rename",
  "/note/c?action=duplicate",
  "/#/note/d/rename",
  "/#/note/d/duplicate",
  "/note/e#rename",
  "/note/e#duplicate",
  "/rename/f",
  "/duplicate/g",
];

test("rapid navigation across all disabled deep-links stays safe", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  // Prime app once.
  await page.goto("/");

  for (const path of variants) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // No rename/duplicate UI or handlers exposed on any variant.
    await expect(page.locator("text=/rename note/i")).toHaveCount(0);
    await expect(page.locator("text=/duplicate note/i")).toHaveCount(0);
    const globalsMissing = await page.evaluate(
      () =>
        typeof (window as unknown as { renameNote?: unknown }).renameNote === "undefined" &&
        typeof (window as unknown as { duplicateNote?: unknown }).duplicateNote === "undefined",
    );
    expect(globalsMissing, `unexpected globals exposed on ${path}`).toBe(true);
  }

  expect(errors, `runtime errors during stress navigation:\n${errors.join("\n")}`).toEqual([]);
});
