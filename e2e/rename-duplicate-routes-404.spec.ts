// Integration-style E2E: confirm rename/duplicate user-facing routes and
// client-side APIs are gone. Hitting them should land on the NotFound page
// and no `renameNote` / `duplicateNote` helpers should be exposed on window.
import { test, expect } from "@playwright/test";

const removedPaths = [
  "/note/rename",
  "/note/duplicate",
  "/some-slug/rename",
  "/some-slug/duplicate",
];

for (const path of removedPaths) {
  test(`GET ${path} renders NotFound (rename/duplicate removed)`, async ({ page }) => {
    const resp = await page.goto(path);
    // SPA — server returns 200 index.html; assert the NotFound UI rendered.
    expect(resp?.status() ?? 200).toBeLessThan(500);
    await expect(page.getByText(/404|not found|không tìm thấy/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });
}

test("no client-side rename/duplicate helpers exposed", async ({ page }) => {
  await page.goto("/");
  const exposed = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      renameNote: typeof w.renameNote,
      duplicateNote: typeof w.duplicateNote,
    };
  });
  expect(exposed.renameNote).toBe("undefined");
  expect(exposed.duplicateNote).toBe("undefined");
});
