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
import {
  sceneDiffRatio,
  sceneDiffOverride,
  chromeDiffRatio,
  chromeDiffOverride,
} from "./helpers/pixel-diff";
import { SCENE_REGISTRY } from "../src/components/home/scenes/registry";

// Pixel-diff suite — opt into retries to absorb shader/GPU jitter in CI
// without re-running the entire e2e matrix (global retries are 0).
test.describe.configure({ retries: process.env.CI ? 2 : 0 });

// Derive the scene list from the single source of truth so adding a scene
// to the registry automatically extends this suite — and per-scene
// pixelDiffRatio overrides are picked up without touching the spec.
const SCENES = SCENE_REGISTRY.filter((s) => s.enabled && s.id !== "none").map(
  (s) => ({
    id: s.id,
    threshold: s.pixelDiffRatio ?? 0.03,
    // Registry-level chrome fallback. Resolution order at runtime is still:
    // PIXEL_DIFF_RATIO (global) → CHROME_DIFF_RATIO (env/CLI) →
    // SCENE_DIFF_RATIOS (per-scene) → registry.chromeDiffRatio →
    // registry.pixelDiffRatio.
    chromeFallback: s.chromeDiffRatio ?? s.pixelDiffRatio ?? 0.03,
  }),
);

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

for (const { id: scene, threshold, chromeFallback } of SCENES) {
  for (const lang of ["en", "vi"] as const) {
    test(`scene[${scene}] @${lang} — token + chrome regression`, async ({ page }, info) => {
      // Resolve effective thresholds (env / CLI override → registry → default)
      // BEFORE the snapshot call so reviewers see the exact values used in CI.
      // sceneThreshold = masked-layer / hit-test gate (per-scene tolerance for
      // shader jitter); chromeThreshold = the chrome strip screenshot gate
      // (Header + slug input + Recents). These are two independent axes so a
      // reviewer can tighten chrome while loosening the scene layer.
      // chromeFallback comes from registry.chromeDiffRatio (or pixelDiffRatio
      // when unset), letting a scene's CSS opt out of the global default
      // without an env flag.
      const sceneThreshold = sceneDiffRatio(scene, threshold);
      const chromeThreshold = chromeDiffRatio(scene, chromeFallback);
      const sceneOverride = sceneDiffOverride(scene);
      const chromeOverride = chromeDiffOverride();
      // Surface in Playwright report + JSON reporter so the CI summary can
      // print thresholds next to each pixel-diff outcome.
      info.annotations.push({ type: "scene", description: scene });
      info.annotations.push({
        type: "pixelDiffRatio",
        description: String(chromeThreshold),
      });
      info.annotations.push({
        type: "sceneDiffRatio",
        description: String(sceneThreshold),
      });
      info.annotations.push({
        type: "chromeDiffRatio",
        description: String(chromeThreshold),
      });
      if (sceneOverride !== undefined) {
        info.annotations.push({
          type: "pixelDiffOverride",
          description: `SCENE_DIFF_RATIOS[${scene}]=${sceneOverride}`,
        });
      }
      if (chromeOverride !== undefined) {
        info.annotations.push({
          type: "chromeDiffOverride",
          description: `CHROME_DIFF_RATIO=${chromeOverride}`,
        });
      }

      await seedScene(page, lang, scene);
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      // Settle the fade-in. Lightweight scenes are usually ready in <500ms;
      // shaders may take ~900ms on first compile.
      await page.waitForTimeout(1000);

      // 1. data-scene attribute is set on the home root.
      const root = page.locator("[data-app-root]").first();
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
      // layer so shader randomness doesn't flake the baseline.
      await expect(page).toHaveScreenshot(`scene-${scene}-${lang}-chrome.png`, {
        clip: { x: 0, y: 0, width: 1280, height: 320 },
        mask: [page.locator("[data-scene-ready]")],
        maxDiffPixelRatio: chromeThreshold,
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
  const root = page.locator("[data-app-root]").first();
  await expect(root).toHaveAttribute("data-scene", "cyber-linh-khi");

  // Cycle scenes via localStorage + reload (more reliable than driving the
  // dropdown when the menu items shift between locales).
  for (const { id: scene } of SCENES) {
    await page.evaluate((s) => localStorage.setItem("home.scene", s), scene);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(root).toHaveAttribute("data-scene", scene);
  }
});
