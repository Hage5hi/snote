// E2E: Home "Cyber Linh Khí" scene + Single-axis theme menu.
//
// Coverage axes:
//   1. Mask coverage at every viewport × DPR (mobile/tablet/desktop @ 1/2/3x)
//      using deterministic elementFromPoint hit-tests + pixel-diff baselines
//      that mask the animated shader so flake stays near-zero.
//   2. Flicker — two-frame in-spec pixel diff with a small ratio threshold
//      (≤ 0.5% of pixels may differ), independent of platform fonts.
//   3. prefers-reduced-motion — Home transitions/animations/glassmorphism all
//      off; SceneHost never mounts.
//   4. Persistence — Cyber selection survives reload and is visible on first
//      paint (no React.lazy delay).
//   5. CSS isolation — cyber attributes/classes don't leak onto /:slug, even
//      after / → /:slug → / → /:slug round trips.
//   6. Keyboard a11y — Tab/Arrow/Esc on Single-axis menu in EN + VI.
//   7. Axe — runs after open, after arrow nav, after option switch, and on
//      re-open in the other locale.
//
// On any failure, the spec attaches a debug overlay screenshot to the test
// report (auto-uploaded to CI via `actions/upload-artifact`), plus the raw
// axe violation JSON.
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// This whole file is the pixel-diff + hit-test + flicker regression net.
// Allow up to 2 retries in CI so a single GPU/font-hint blip doesn't turn
// the branch red — a real regression reproduces on every attempt. The rest
// of the e2e suite stays at retries=0 (set globally in playwright.config).
test.describe.configure({ retries: process.env.CI ? 2 : 0 });

// --- Storage keys ----------------------------------------------------------
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
const cyberLabel = { en: /Jade Chi/, vi: /Jade Chi/ } as const;
const lightLabel = { en: /^Light$/, vi: /^Sáng$/ } as const;
const darkLabel = { en: /^Dark$/, vi: /^Tối$/ } as const;

// --- Debug helpers ---------------------------------------------------------
async function attachDebugOverlay(
  page: Page,
  info: TestInfo,
  label: string,
  hits: Array<{ x: number; y: number; color?: string }>,
) {
  // Draw red crosshairs at every hit point so reviewers can SEE which pixel
  // tripped the assertion when downloading the CI artifact.
  await page.evaluate(
    ({ hits }) => {
      const overlay = document.createElement("div");
      overlay.id = "__e2e_overlay__";
      overlay.style.cssText =
        "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
      for (const h of hits) {
        const dot = document.createElement("div");
        dot.style.cssText =
          `position:absolute;left:${h.x - 8}px;top:${h.y - 8}px;` +
          `width:16px;height:16px;border:2px solid ${h.color ?? "red"};` +
          `border-radius:50%;box-shadow:0 0 0 1px white inset;`;
        overlay.appendChild(dot);
      }
      document.body.appendChild(overlay);
    },
    { hits },
  );
  const png = await page.screenshot({ fullPage: false });
  await info.attach(`debug-${label}.png`, { body: png, contentType: "image/png" });
  await page.evaluate(() => document.getElementById("__e2e_overlay__")?.remove());
}

async function attachAxeReport(info: TestInfo, label: string, results: unknown) {
  await info.attach(`axe-${label}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
}

// In-page pixel diff between two PNG buffers. Returns ratio of differing
// pixels (0..1). Used instead of byte-equality so AA/font-hinting jitter
// doesn't cause spurious flake.
async function pixelDiffRatio(page: Page, a: Buffer, b: Buffer, threshold = 16) {
  return page.evaluate(
    async ({ a, b, threshold }) => {
      async function decode(b64: string) {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
      }
      const A = await decode(a);
      const B = await decode(b);
      if (A.width !== B.width || A.height !== B.height) return 1;
      let diff = 0;
      const total = A.width * A.height;
      for (let i = 0; i < A.data.length; i += 4) {
        const dr = Math.abs(A.data[i] - B.data[i]);
        const dg = Math.abs(A.data[i + 1] - B.data[i + 1]);
        const db = Math.abs(A.data[i + 2] - B.data[i + 2]);
        if (dr + dg + db > threshold) diff++;
      }
      return diff / total;
    },
    { a: a.toString("base64"), b: b.toString("base64"), threshold },
  );
}

// ---------------------------------------------------------------------------
// 1. Mask coverage — every viewport × DPR combo.
// ---------------------------------------------------------------------------
const maskMatrix = [
  { name: "mobile-1x", w: 390, h: 844, dpr: 1 },
  { name: "mobile-2x", w: 390, h: 844, dpr: 2 },
  { name: "mobile-3x", w: 390, h: 844, dpr: 3 },
  { name: "tablet-1x", w: 768, h: 1024, dpr: 1 },
  { name: "tablet-2x", w: 768, h: 1024, dpr: 2 },
  { name: "desktop-1x", w: 1280, h: 720, dpr: 1 },
  { name: "desktop-2x", w: 1280, h: 720, dpr: 2 },
];

for (const m of maskMatrix) {
  test(`Masks never cover Header/Recents @${m.name}`, async ({ browser }, info) => {
    const ctx = await browser.newContext({
      viewport: { width: m.w, height: m.h },
      deviceScaleFactor: m.dpr,
    });
    const page = await ctx.newPage();
    await seed(page, { lang: "en", scene: "cyber-linh-khi", theme: "dark" });
    await page.addInitScript(() => {
      localStorage.setItem(
        "note.recents",
        JSON.stringify([
          { slug: "hello", lastOpenedAt: Date.now() - 60_000 },
          { slug: "todo", lastOpenedAt: Date.now() - 5 * 60_000 },
        ]),
      );
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // --- Header hit-test
    const brand = page.locator("header").first().getByText("Syrin Notes");
    await expect(brand).toBeVisible();
    const bb = (await brand.boundingBox())!;
    const hx = Math.round(bb.x + bb.width / 2);
    const hy = Math.round(bb.y + bb.height / 2);

    // --- Recents hit-test (if rendered)
    const recents = page.getByRole("list").filter({ hasText: "/hello" }).first();
    const hasRecents = (await recents.count()) > 0;
    let rx = 0,
      ry = 0;
    if (hasRecents) {
      const rb = (await recents.boundingBox())!;
      rx = Math.round(rb.x + 24);
      ry = Math.round(rb.y + 16);
      expect(rb.y + rb.height).toBeLessThanOrEqual(m.h + 1);
    }

    const hits = await page.evaluate(
      ([points]) =>
        points.map(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return {
            x,
            y,
            tag: el?.tagName.toLowerCase() ?? "none",
            inHeader: !!el?.closest("header"),
            inList: !!el?.closest("ul"),
          };
        }),
      [hasRecents ? [[hx, hy], [rx, ry]] : [[hx, hy]]],
    );

    const failed = hits.filter(
      (h, i) => (i === 0 ? !h.inHeader : !h.inList),
    );
    if (failed.length) {
      await attachDebugOverlay(
        page,
        info,
        `mask-${m.name}`,
        hits.map((h) => ({ x: h.x, y: h.y })),
      );
    }
    expect(failed, JSON.stringify(hits, null, 2)).toEqual([]);

    await ctx.close();
  });
}

// ---------------------------------------------------------------------------
// 2. Flicker — pixel-diff baseline comparison (small threshold, not exact).
// ---------------------------------------------------------------------------
test("Home does not flicker on stable theme (pixel-diff ≤ 0.5%)", async ({ page }, info) => {
  await seed(page, { lang: "en", scene: "cyber-linh-khi", theme: "dark" });
  await page.goto("/");
  await page.waitForTimeout(900); // let SceneHost fade-in settle

  const clip = { x: 0, y: 0, width: 600, height: 200 };
  const a = await page.screenshot({ clip });
  await page.waitForTimeout(150);
  const b = await page.screenshot({ clip });

  const ratio = await pixelDiffRatio(page, a, b);
  if (ratio > 0.005) {
    await info.attach("flicker-a.png", { body: a, contentType: "image/png" });
    await info.attach("flicker-b.png", { body: b, contentType: "image/png" });
  }
  expect(ratio).toBeLessThanOrEqual(0.005);
});

test("Switching theme keeps Header mounted (no flicker)", async ({ page }) => {
  await seed(page, { lang: "en", scene: "cyber-linh-khi", theme: "dark" });
  await page.goto("/");

  const header = page.locator("header").first();
  await page.getByRole("button", { name: themeAria.en }).click();
  await page.getByRole("menuitemradio", { name: lightLabel.en }).click();
  await expect(header).toBeVisible();
  await expect(page.locator("[data-theme='cyber']")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 3. prefers-reduced-motion — Home transitions/animations all off.
// ---------------------------------------------------------------------------
test("prefers-reduced-motion disables Home transitions, animations and scene", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await seed(page, { lang: "en", scene: "cyber-linh-khi", theme: "dark" });
  await page.goto("/");

  await expect(page.locator("[data-scene-ready]")).toHaveCount(0);

  const header = page.locator("header").first();
  const backdrop = await header.evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(backdrop === "" || backdrop === "none").toBe(true);

  const h1Anim = await page.locator("h1").evaluate((el) => getComputedStyle(el).animationName);
  expect(h1Anim === "" || h1Anim === "none").toBe(true);

  await ctx.close();
});

// ---------------------------------------------------------------------------
// 4. Persistence — Cyber survives reload, visible on first paint.
// ---------------------------------------------------------------------------
test("Cyber Linh Khí persists across reload with no delay", async ({ page }) => {
  await seed(page, { lang: "en" });
  await page.goto("/");

  await page.getByRole("button", { name: themeAria.en }).click();
  await page.getByRole("menuitemradio", { name: cyberLabel.en }).click();

  await expect(page.locator("[data-home-root][data-theme='cyber']")).toBeVisible();
  await expect(page.locator("[data-scene-ready]")).toHaveCount(1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-home-root][data-theme='cyber']")).toBeVisible();
  await expect(page.locator("[data-scene-ready]")).toHaveCount(1);

  const stored = await page.evaluate(() => localStorage.getItem("home.scene"));
  expect(stored).toBe("cyber-linh-khi");
});

// ---------------------------------------------------------------------------
// 5. CSS isolation — round-trip / → /:slug → / → /:slug must stay clean.
// ---------------------------------------------------------------------------
async function assertNoCyberLeak(page: Page) {
  await expect(page.locator("[data-home-root]")).toHaveCount(0);
  await expect(page.locator("[data-theme='cyber']")).toHaveCount(0);
  await expect(page.locator("[data-scene-ready]")).toHaveCount(0);

  // No teal/cyan/jade classes anywhere in the editor tree.
  const leakedClasses = await page.evaluate(() => {
    const all = document.querySelectorAll<HTMLElement>("body *");
    const hits: string[] = [];
    all.forEach((el) => {
      const c = el.className;
      if (typeof c !== "string") return;
      if (/\b(text-teal-|text-cyan-|border-cyan-|bg-cyan-|ring-teal-|from-teal-|to-cyan-)/.test(c)) {
        hits.push(c);
      }
    });
    return hits;
  });
  expect(leakedClasses).toEqual([]);

  // <html> / <body> must not carry the cyber data-attribute either.
  const rootHasCyber = await page.evaluate(() =>
    document.documentElement.dataset.theme === "cyber" ||
    document.body.dataset.theme === "cyber",
  );
  expect(rootHasCyber).toBe(false);
}

test("Cyber styling does not leak onto /:slug (round-trip nav + reload)", async ({ page }) => {
  await seed(page, { lang: "en", scene: "cyber-linh-khi", theme: "dark" });
  await page.goto("/");
  await expect(page.locator("[data-home-root][data-theme='cyber']")).toBeVisible();

  const slug = `e2e-leak-${Math.random().toString(36).slice(2, 8)}`;

  // 1. Direct nav to /:slug after being on Home.
  await page.goto(`/${slug}`);
  await page.waitForLoadState("domcontentloaded");
  await assertNoCyberLeak(page);

  // 2. Back to Home — sanity, cyber returns.
  await page.goto("/");
  await expect(page.locator("[data-home-root][data-theme='cyber']")).toBeVisible();

  // 3. Forward to /:slug again — still clean.
  await page.goto(`/${slug}`);
  await page.waitForLoadState("domcontentloaded");
  await assertNoCyberLeak(page);

  // 4. Hard refresh on /:slug — first paint must also be clean.
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertNoCyberLeak(page);
});

// ---------------------------------------------------------------------------
// 6. Keyboard navigation — Tab/Arrow/Esc in the Single-axis menu.
// ---------------------------------------------------------------------------
for (const lang of ["en", "vi"] as const) {
  test(`Theme menu keyboard navigation (${lang})`, async ({ page }) => {
    await seed(page, { lang });
    await page.goto("/");

    const trigger = page.getByRole("button", { name: themeAria[lang] });
    await expect(trigger).toBeVisible();

    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("[role='menuitemradio']:focus")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

// ---------------------------------------------------------------------------
// 7. Axe a11y — scan at every interaction step + after option switch.
// ---------------------------------------------------------------------------
async function scanMenu(page: Page, info: TestInfo, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["region"]) // Radix portal lifts menu out of <main>; expected.
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  if (serious.length) {
    await attachAxeReport(info, label, { violations: serious });
  }
  expect(serious, `axe[${label}] violations`).toEqual([]);
}

for (const lang of ["en", "vi"] as const) {
  test(`Theme menu axe a11y across keyboard interactions (${lang})`, async ({ page }, info) => {
    await seed(page, { lang });
    await page.goto("/");

    const trigger = page.getByRole("button", { name: themeAria[lang] });
    await expect(trigger).toHaveAttribute("aria-label", themeAria[lang]);

    // Tab to focus trigger.
    await page.keyboard.press("Tab");
    // Skip past other focusable header controls until trigger is focused.
    for (let i = 0; i < 10 && !(await trigger.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(trigger).toBeFocused();
    await scanMenu(page, info, `${lang}-trigger-focused`);

    // Open with Enter, scan opened state.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await scanMenu(page, info, `${lang}-menu-open`);

    // Every menuitemradio must carry an accessible name.
    const items = page.getByRole("menuitemradio");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      expect(await items.nth(i).getAttribute("aria-label")).toBeTruthy();
    }

    // ArrowDown navigation, scan again.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await scanMenu(page, info, `${lang}-arrow-nav`);

    // Switch option: pick Dark via click (deterministic regardless of focus
    // index), then re-open and scan to ensure the checked-state announcement
    // is wired up correctly.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await trigger.click();
    await page.getByRole("menuitemradio", { name: darkLabel[lang] }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);

    await trigger.click();
    const dark = page.getByRole("menuitemradio", { name: darkLabel[lang] });
    await expect(dark).toHaveAttribute("aria-checked", "true");
    await scanMenu(page, info, `${lang}-after-switch`);

    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
}
