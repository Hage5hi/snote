// E2E: rename/duplicate deep-link variants (query params + hash routes)
// must all be disabled and land on a safe not-found state.
import { test, expect } from "@playwright/test";

const RENAME_RE = /rename|đổi tên|переимен|重命名|이름 바꾸기|renombrar|renommer|umbenennen/i;
const DUP_RE = /duplicate|nhân bản|дубли|复制|복제|duplicar|dupliquer|duplizieren/i;
const NOT_FOUND_RE = /404|not found|không tìm thấy/i;

const variants = [
  "/note/anything/rename",
  "/note/anything/duplicate",
  "/note/anything/rename?name=foo",
  "/note/anything/duplicate?target=bar&force=1",
  "/note/anything?action=rename",
  "/note/anything?action=duplicate",
  "/#/note/anything/rename",
  "/#/note/anything/duplicate",
  "/note/anything#rename",
  "/note/anything#duplicate",
  "/rename/anything",
  "/duplicate/anything",
];

for (const path of variants) {
  test(`deep-link variant disabled: ${path}`, async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const resp = await page.goto(path);
    expect(resp?.status() ?? 200).toBeLessThan(500);
    // Give SPA + hash routers a moment to settle.
    await page.waitForTimeout(200);

    const text = await page.locator("body").innerText();
    // No rename/duplicate UI surfaced by any variant.
    expect(text).not.toMatch(RENAME_RE);
    expect(text).not.toMatch(DUP_RE);
    // No confirm() / prompt() fired automatically.
    expect(dialogs).toEqual([]);
    // No exposed helper got wired up as a side effect.
    const exposed = await page.evaluate(() => ({
      rename: typeof (window as unknown as Record<string, unknown>).renameNote,
      duplicate: typeof (window as unknown as Record<string, unknown>).duplicateNote,
    }));
    expect(exposed).toEqual({ rename: "undefined", duplicate: "undefined" });
    // Non-existent /note/* paths land on NotFound; home-ish paths (# fragments
    // on "/") stay on the home shell — either is a safe outcome.
    if (path.startsWith("/note/anything/") || path.startsWith("/rename") || path.startsWith("/duplicate")) {
      expect(text).toMatch(NOT_FOUND_RE);
    }
  });
}
