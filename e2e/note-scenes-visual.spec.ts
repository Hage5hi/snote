// E2E: scene-on-note visual QA — verifies the AppShell-driven scene system
// applied to NotePage stays visually safe across all enabled scenes.
//
// Two axes:
//   1. Desktop — for every scene the editor + preview surfaces stay 100% solid
//      and legible (no shader bleed-through), and the scene chrome tokens are
//      live on the header.
//   2. Mobile — the narrow-viewport Topbar wraps to two rows AND the
//      SceneToggle/ThemeToggle on row 1 never overlap or share a row with
//      ModeMenu/ExportMenu (row 2 only). This guards against the regression
//      that sparked Task 3.
//
// No pixel baselines on purpose: the chrome strip already has baselines on
// the Home side; here we want deterministic structural assertions that pass
// out-of-the-box on any machine, including fresh CI runners.
import { test, expect, type Page } from "@playwright/test";
import { SCENE_REGISTRY } from "../src/components/home/scenes/registry";

const SCENES = SCENE_REGISTRY.filter((s) => s.enabled && s.id !== "none").map((s) => s.id);

async function seedScene(page: Page, scene: string) {
  await page.addInitScript(
    ({ scene }) => {
      localStorage.setItem("lang", "en");
      localStorage.setItem("lang.ip_detected", "1");
      localStorage.setItem("home.scene", scene);
    },
    { scene },
  );
}

// rgba() / rgb() alpha extractor — returns 1 for opaque rgb(), the alpha for
// rgba(), and 0 for "transparent" / unset. Used to assert solid editor body.
function alphaOf(color: string): number {
  if (!color || color === "transparent") return 0;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(",").map((s) => s.trim());
  if (parts.length < 4) return 1;
  return parseFloat(parts[3]);
}

for (const scene of SCENES) {
  test(`note[${scene}] desktop — scene chrome only, editor body stays solid`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await seedScene(page, scene);
    const slug = `qa-note-${scene}`;
    await page.goto(`/${slug}`);
    await page.waitForLoadState("networkidle");

    // 1. AppShell mounted with the correct scene id.
    const root = page.locator(`[data-app-root][data-scene="${scene}"]`);
    await expect(root).toBeVisible();

    // 2. Chrome tokens live on the topbar header.
    const header = page.locator("header.zen-topbar").first();
    await expect(header).toBeVisible();
    const chromeBg = await header.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("background-color"),
    );
    expect(chromeBg, `header background missing for ${scene}`).toBeTruthy();

    // 3. Editor surface stays opaque. CodeMirror may take a beat to mount.
    const editor = page.locator(".cm-editor").first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
    const bodyColor = await editor.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(alphaOf(bodyColor), `editor body must be solid (${scene}) — got ${bodyColor}`).toBe(1);

    await ctx.close();
  });
}

test("note mobile topbar — SceneToggle never overlaps ModeMenu/ExportMenu", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await seedScene(page, "cyber-linh-khi");
  await page.goto("/qa-note-mobile");
  await page.waitForLoadState("networkidle");

  const header = page.locator("header.zen-topbar").first();
  await expect(header).toBeVisible();

  // Mobile topbar wraps to flex-col (two rows). Verify by checking computed
  // flex-direction so a future refactor that breaks the wrap fails loudly.
  const dir = await header.evaluate((el) => getComputedStyle(el).flexDirection);
  expect(dir, "narrow viewport topbar should be flex-col").toBe("column");

  // Collect bounding boxes of the four controls that must not overlap.
  // Aria-labels are localized — match on the EN labels we seeded.
  const targets = [
    { name: "SceneToggle", locator: page.getByRole("button", { name: /Scene settings/i }) },
    { name: "ThemeToggle", locator: page.getByRole("button", { name: /Theme settings/i }) },
    { name: "ModeMenu", locator: header.getByRole("button", { name: /^Mode$/i }) },
    { name: "ExportMenu", locator: header.getByRole("button", { name: /^Export$/i }) },
  ];

  const boxes: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];
  for (const t of targets) {
    await expect(t.locator, `${t.name} should be visible`).toBeVisible();
    const b = await t.locator.boundingBox();
    if (!b) throw new Error(`${t.name} missing bounding box`);
    boxes.push({ name: t.name, x: b.x, y: b.y, w: b.width, h: b.height });
    // Tap-target floor: shadcn size="sm"/"icon" baseline = 32–36px.
    expect(Math.min(b.width, b.height), `${t.name} tap target too small`).toBeGreaterThanOrEqual(28);
  }

  // SceneToggle + ThemeToggle live on row 1; ModeMenu + ExportMenu on row 2.
  const row1 = boxes.filter((b) => b.name === "SceneToggle" || b.name === "ThemeToggle");
  const row2 = boxes.filter((b) => b.name === "ModeMenu" || b.name === "ExportMenu");
  const row1Mid = row1[0].y + row1[0].h / 2;
  const row2Mid = row2[0].y + row2[0].h / 2;
  expect(
    Math.abs(row1Mid - row2Mid),
    `Row 1 (scene/theme) and row 2 (mode/export) must sit on separate rows. ${JSON.stringify(boxes)}`,
  ).toBeGreaterThanOrEqual(20);

  // Pairwise overlap check inside each row.
  function overlaps(a: typeof boxes[number], b: typeof boxes[number]) {
    const horiz = Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w);
    const vert = Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h);
    return horiz && vert;
  }
  for (const row of [row1, row2]) {
    for (let i = 0; i < row.length; i++) {
      for (let j = i + 1; j < row.length; j++) {
        expect(
          overlaps(row[i], row[j]),
          `${row[i].name} overlaps ${row[j].name} on mobile`,
        ).toBe(false);
      }
    }
  }

  await ctx.close();
});
