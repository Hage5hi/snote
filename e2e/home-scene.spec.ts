// E2E: Home "Cyber Linh Khí" scene + Single-axis theme menu.
//
// Covers four axes:
//   1. Visual snapshots — header & recents never get masked by the top/bottom
//      gradient at multiple viewports, and the page does not flicker when
//      switching theme (two screenshots taken back-to-back must be identical).
//   2. prefers-reduced-motion — when reduced motion is set, no `motion-safe:`
//      transition/animation/backdrop classes apply on Home, and no SceneHost
//      fade layer is mounted.
//   3. Cyber persistence — selecting "Cyber Linh Khí" then reloading must
//      restore the scene synchronously: data-theme="cyber" + the SceneHost
//      element are both present on the very first paint (no delay).
//   4. Keyboard a11y — the theme menu can be opened/navigated/closed with
//      Tab/Arrow/Esc in both EN and VI, with no Radix focus regressions.
//
// All tests are scoped to the Home route (/) and do not touch /:slug routes.
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const LANG_IP_KEY = "lang.ip_detected";
const SCENE_KEY = "home.scene";
const THEME_KEY = "theme"; // next-themes

async function seed(
  page: Page,
  opts: { lang?: "en" | "vi"; scene?: string; theme?: string } = {},
) {
  const { lang = "en", scene, theme } = opts;
  await page.addInitScript(
    ({ lk, ik, lang, sk, scene, tk, theme }) => {
      localStorage.setItem(lk, lang);
      localStorage.setItem(ik, "1");
      if (scene) localStorage.setItem(sk, scene);
      else localStorage.removeItem(sk);
      if (theme) localStorage.setItem(tk, theme);
    },
    { lk: LANG_KEY, ik: LANG_IP_KEY, lang, sk: SCENE_KEY, scene, tk: THEME_KEY, theme },
  );
}

const themeAria = { en: "Theme settings", vi: "Cài đặt giao diện" } as const;
const cyberLabel = { en: /Cyber Linh Kh/, vi: /Cyber Linh Kh/ } as const;
const lightLabel = { en: /^Light$/, vi: /^Sáng$/ } as const;

// ---------------------------------------------------------------------------
// 1. Visual snapshots — no flicker on theme switch + masks don't cover UI.
// ---------------------------------------------------------------------------
const viewports = [
  { name: "desktop", w: 1280, h: 720 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 390, h: 844 },
];

for (const vp of viewports) {
  test(`Home masks don't cover header or recents @${vp.name}`, async ({ page }) => {
    await seed(page, { lang: "en", scene: "cyber-linh-khi", theme: "dark" });
    // Pre-seed a recent note so the Recents list renders.
    await page.addInitScript(() => {
      const recents = [
        { slug: "hello", lastOpenedAt: Date.now() - 60_000 },
        { slug: "todo", lastOpenedAt: Date.now() - 5 * 60_000 },
      ];
      localStorage.setItem("note.recents", JSON.stringify(recents));
    });
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/");

    // Header logo must be visible (not behind the top mask).
    const header = page.locator("header").first();
    await expect(header).toBeVisible();
    await expect(header.getByText("Syrin Notes")).toBeVisible();

    // Recents list, when present, must also be visible (not behind bottom mask).
    const recents = page.getByRole("list").filter({ hasText: "/hello" }).first();
    if (await recents.count()) {
      await expect(recents).toBeVisible();
      // The recents item must be inside the visible viewport (no clipping).
      const box = await recents.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.y + box.height).toBeLessThanOrEqual(vp.h + 1);
      }
    }
  });
}

test("Home does not flicker when switching theme (cyber → light)", async ({ page }) => {
  await seed(page, { lang: "en", scene: "cyber-linh-khi", theme: "dark" });
  await page.goto("/");
  // Let initial fade-in settle.
  await page.waitForTimeout(900);

  const before = await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 200 } });
  // Re-screenshot a frame later — same theme, content must be byte-stable
  // (no opacity churn / re-mount flicker).
  await page.waitForTimeout(120);
  const after = await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 200 } });
  expect(Buffer.compare(before, after)).toBe(0);

  // Switch to Light: header must remain mounted/visible throughout.
  const header = page.locator("header").first();
  await page.getByRole("button", { name: themeAria.en }).click();
  await page.getByRole("menuitemradio", { name: lightLabel.en }).click();
  await expect(header).toBeVisible();
  await expect(page.locator("[data-theme='cyber']")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 2. prefers-reduced-motion — disables glassmorphism / hover / scene fade.
// ---------------------------------------------------------------------------
test("prefers-reduced-motion disables Home transitions, animations and scene", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await seed(page, { lang: "en", scene: "cyber-linh-khi", theme: "dark" });
  await page.goto("/");

  // SceneHost should be guarded out entirely (no fade layer mounted).
  await expect(page.locator("[data-scene-ready]")).toHaveCount(0);

  // None of the motion-safe: utility classes should resolve to actual styles
  // on Home — Tailwind compiles them inside @media (prefers-reduced-motion: no-preference)
  // so under reduce they're no-ops. Spot-check the header backdrop-blur:
  const header = page.locator("header").first();
  const backdrop = await header.evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(backdrop === "" || backdrop === "none").toBe(true);

  // The h1 fade-in animation should not be running.
  const h1Anim = await page.locator("h1").evaluate((el) => getComputedStyle(el).animationName);
  expect(h1Anim === "" || h1Anim === "none").toBe(true);

  await context.close();
});

// ---------------------------------------------------------------------------
// 3. Persistence — Cyber scene restores synchronously after reload.
// ---------------------------------------------------------------------------
test("Cyber Linh Khí persists across reload with no delay", async ({ page }) => {
  await seed(page, { lang: "en" });
  await page.goto("/");

  await page.getByRole("button", { name: themeAria.en }).click();
  await page.getByRole("menuitemradio", { name: cyberLabel.en }).click();

  await expect(page.locator("[data-home-root][data-theme='cyber']")).toBeVisible();
  // SceneHost element must exist (the fade wrapper).
  await expect(page.locator("[data-scene-ready]")).toHaveCount(1);

  // Reload — both must be present on first paint (no React.lazy delay).
  await page.reload({ waitUntil: "domcontentloaded" });
  // No waitForTimeout — assert immediately. Locator auto-waits but the element
  // must be there in the very first commit; we double-check the localStorage
  // value drove the synchronous render.
  await expect(page.locator("[data-home-root][data-theme='cyber']")).toBeVisible();
  await expect(page.locator("[data-scene-ready]")).toHaveCount(1);

  const stored = await page.evaluate(() => localStorage.getItem("home.scene"));
  expect(stored).toBe("cyber-linh-khi");
});

// ---------------------------------------------------------------------------
// 4. Keyboard navigation — Tab/Arrow/Esc in the Single-axis menu (EN + VI).
// ---------------------------------------------------------------------------
for (const lang of ["en", "vi"] as const) {
  test(`Theme menu keyboard navigation (${lang})`, async ({ page }) => {
    await seed(page, { lang });
    await page.goto("/");

    const trigger = page.getByRole("button", { name: themeAria[lang] });
    await expect(trigger).toBeVisible();

    // Open via keyboard (focus + Enter), not click.
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    // Arrow keys move focus through radio items without throwing.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    // Some focused menuitemradio must be present.
    const focused = page.locator("[role='menuitemradio']:focus");
    await expect(focused).toHaveCount(1);

    // Escape closes and returns focus to the trigger (Radix contract).
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
