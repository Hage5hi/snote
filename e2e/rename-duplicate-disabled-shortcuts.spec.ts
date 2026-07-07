// E2E: rename & duplicate are fully disabled — not surfaced in UI, not
// triggered by legacy keyboard shortcuts, not reachable via deep links.
import { test, expect } from "@playwright/test";

const RENAME_RE = /rename|đổi tên|переимен|重命名|이름 바꾸기|renombrar|renommer|umbenennen/i;
const DUP_RE = /duplicate|nhân bản|дубли|复制|복제|duplicar|dupliquer|duplizieren/i;

test("no rename/duplicate UI, shortcuts, or deep links", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  // 1) Home has neither term visible.
  await page.goto("/");
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(RENAME_RE);
  expect(bodyText).not.toMatch(DUP_RE);

  // 2) Legacy keyboard shortcuts (F2 rename, Ctrl/Cmd+D duplicate) are inert:
  // no dialog, no route change, no globally exposed handler.
  const before = page.url();
  await page.keyboard.press("F2");
  await page.keyboard.press("Control+D");
  await page.keyboard.press("Meta+D");
  await page.waitForTimeout(200);
  expect(page.url()).toBe(before);
  expect(dialogs).toEqual([]);
  const handlers = await page.evaluate(() => ({
    rename: typeof (window as unknown as Record<string, unknown>).renameNote,
    duplicate: typeof (window as unknown as Record<string, unknown>).duplicateNote,
  }));
  expect(handlers).toEqual({ rename: "undefined", duplicate: "undefined" });

  // 3) Deep links respond with the SPA NotFound view (no rename/dup UI).
  for (const path of ["/note/anything/rename", "/note/anything/duplicate"]) {
    await page.goto(path);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(RENAME_RE);
    expect(text).not.toMatch(DUP_RE);
    expect(text).toMatch(/404|not found|không tìm thấy/i);
  }
});
