// Right-clicking the Home arrow in the Topbar opens the home route in a
// new tab (see src/components/note/topbar/TopbarBrand.tsx onContextMenu).
// Left-click still navigates in place — covered elsewhere; we only assert
// the right-click branch here.

import { test, expect } from "@playwright/test";
import { seedVersionedPlaintextNote, deleteNote } from "./helpers/seed-note";

test("right-clicking the Home button opens a new tab to '/'", async ({ context, page }) => {
  const slug = await seedVersionedPlaintextNote("home-rmb", "hello");
  try {
    await page.goto(`/${slug}`);
    const home = page.getByRole("link", { name: /home|trang chủ|首页|ホーム|홈|accueil|inicio|start|início/i }).first();
    await home.waitFor({ state: "visible" });

    const popupPromise = context.waitForEvent("page");
    // dispatchEvent is more reliable cross-browser than page.click({button:'right'})
    // because our handler runs on `contextmenu`, which chromium/webkit deliver
    // consistently through the DOM event API.
    await home.dispatchEvent("contextmenu");

    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    expect(new URL(popup.url()).pathname).toBe("/");
    // Original tab stays on the note.
    expect(new URL(page.url()).pathname).toBe(`/${slug}`);
    await popup.close();
  } finally {
    await deleteNote(slug);
  }
});
