// E2E: per-scene visual regression + i18n token sanity.
//
// For every enabled scene in SCENE_REGISTRY:
//   1. Seed the scene + EN locale, navigate to /, wait for first-frame.
//   2. Mask out the animated background (it's intentionally moving) and
//      snapshot the chrome (Header + slug input + Recents) — this catches
//      CSS token drift without flaking on shader randomness.
//   3. Assert the `data-scene` attribute matches and the title's
//      `--home-title-grad` resolves to a non-empty linear-gradient.
//   4. Re-run in VI to confirm i18n labels are present + chrome layout
//      doesn't shift more than the small diff threshold.
//
// Run baseline update locally with:
//   bun run test:e2e:update:scene
import { test, expect, type Page } from "@playwright/test";

const SCENES = [
  "cyber-linh-khi",
  "ethereal-aurora",
  "obsidian-ink",
  "digital-constellation",
  "neon-vapor",
  "terminal-boot",
] as const;

const themeAria = { en: "Theme settings", vi: "Cài đặt giao diện" } as const;

async function seedScene(page: Page, lang: "en" | "vi", scene: string) {
  await page.addInitScript(
    ({ lang, scene }) => {
      localStorage.setItem("lang", lang);
      localStorage.setItem("lang.ip_detected", "1");
      localStorage.setItem("home.scene", scene);
      localStorage.setItem(
        "note.recents",
        JSON.stringify([
          { slug: "alpha", lastOpenedAt: Date.now() - 60_000 },
          { slug: "beta", lastOpenedAt: Date.now() - 5 * 60_000 },
        ]),
      );
    },
    { lang, scene },
  );
}

for (const scene of SCENES) {
  for (const lang of ["en", "vi"] as const) {
    test(`scene[${scene}] @${lang} — token + chrome regression`, async ({ page }) => {
      await seedScene(page, lang, scene);
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      // Settle the fade-in. Lightweight scenes are usually ready in <500ms;
      // shaders may take ~900ms on first compile.
      await page.waitForTimeout(1000);

      // 1. data-scene attribute is set on the home root.
      const root = page.locator("[data-home-root]").first();
      await expect(root).toHaveAttribute("data-scene", scene);

      // 2. --home-title-grad token resolves to a real gradient.
      const grad = await root.evaluate(
        (el) => getComputedStyle(el).getPropertyValue("--home-title-grad").trim(),
      );
      expect(grad, `--home-title-grad missing for ${scene}`).toMatch(/linear-gradient/i);

      // 3. Trigger button carries the localized aria-label.
      const trigger = page.getByRole("button", { name: themeAria[lang] });
      await expect(trigger).toBeVisible();

      // 4. Snapshot the chrome strip (top 320px). Mask the animated scene
      // layer so shader randomness doesn't flake the baseline; the chrome
      // sits *above* the scene so the visible diff stays in design-system
      // tokens only.
      await expect(page).toHaveScreenshot(`scene-${scene}-${lang}-chrome.png`, {
        clip: { x: 0, y: 0, width: 1280, height: 320 },
        mask: [page.locator("[data-scene-ready]")],
        maxDiffPixelRatio: 0.03,
        animations: "disabled",
      });
    });
  }
}

// Bonus: assert that every scene transitions cleanly when picked at runtime.
// This is the regression net for the "WebGL-required scene falls back to
// none" path — if hasWebGL() returns false the data-scene attr stays empty
// and the test catches it.
test("every enabled scene can be selected at runtime", async ({ page }) => {
  await seedScene(page, "en", "cyber-linh-khi");
  await page.goto("/");
  const root = page.locator("[data-home-root]").first();
  await expect(root).toHaveAttribute("data-scene", "cyber-linh-khi");

  // Cycle scenes via localStorage + reload (more reliable than driving the
  // dropdown when the menu items shift between locales).
  for (const scene of SCENES) {
    await page.evaluate((s) => localStorage.setItem("home.scene", s), scene);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(root).toHaveAttribute("data-scene", scene);
  }
});
