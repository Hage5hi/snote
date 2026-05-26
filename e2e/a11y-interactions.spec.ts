// E2E: axe a11y regression net for locale + menu-option switches.
//
// Verifies that interacting with the language toggle and theme dropdown
// (Light → Dark → Cyber and back) never introduces a NEW serious/critical
// axe violation. Each scan is diffed against the baseline taken right after
// the initial page load — only newly introduced violation IDs fail the test.
//
// Why diff rather than absolute? Pre-existing issues (e.g. a missing
// landmark on a Radix portal) are tracked separately. We only want this
// suite red when an interaction *creates* a new accessibility regression.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type Violation = { id: string; impact?: string | null };

async function scan(page: Page): Promise<Violation[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["region"]) // Radix portal lifts menu out of <main>; expected.
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact ?? null }));
}

function newViolations(baseline: Violation[], current: Violation[]): Violation[] {
  const seen = new Set(baseline.map((v) => v.id));
  return current.filter((v) => !seen.has(v.id));
}

async function seed(page: Page, lang: "en" | "vi") {
  await page.addInitScript(
    ({ lang }) => {
      localStorage.setItem("lang", lang);
      localStorage.setItem("lang.ip_detected", "1");
      localStorage.removeItem("home.scene");
    },
    { lang },
  );
}

const themeAria = { en: "Theme settings", vi: "Cài đặt giao diện" } as const;
const lightLabel = { en: /^Light$/, vi: /^Sáng$/ } as const;
const darkLabel = { en: /^Dark$/, vi: /^Tối$/ } as const;
const cyberLabel = { en: /Jade Chi/, vi: /Jade Chi/ } as const;
const langAria = { en: /Language|language/i, vi: /Ngôn ngữ|ngon ngu/i } as const;

test("axe: no new violations after switching theme options (en)", async ({ page }, info) => {
  await seed(page, "en");
  await page.goto("/");
  const baseline = await scan(page);

  const trigger = page.getByRole("button", { name: themeAria.en });

  for (const label of [lightLabel.en, darkLabel.en, cyberLabel.en]) {
    await trigger.click();
    await page.getByRole("menuitemradio", { name: label }).click();
    // Let next-themes flush + the scene fade-in start.
    await page.waitForTimeout(250);

    const current = await scan(page);
    const introduced = newViolations(baseline, current);
    if (introduced.length) {
      await info.attach(`axe-after-${String(label)}.json`, {
        body: JSON.stringify(introduced, null, 2),
        contentType: "application/json",
      });
    }
    expect(introduced, `new axe violations after ${label}`).toEqual([]);
  }
});

test("axe: no new violations after switching locale en → vi → en", async ({ page }, info) => {
  await seed(page, "en");
  await page.goto("/");
  const baseline = await scan(page);

  const langTrigger = page.getByRole("button", { name: langAria.en }).first();

  // en → vi
  await langTrigger.click();
  await page.getByRole("menuitemradio", { name: /Tiếng Việt/ }).click();
  await page.waitForTimeout(250);
  let current = await scan(page);
  let introduced = newViolations(baseline, current);
  if (introduced.length) {
    await info.attach("axe-after-en-to-vi.json", {
      body: JSON.stringify(introduced, null, 2),
      contentType: "application/json",
    });
  }
  expect(introduced, "new axe violations after switching to vi").toEqual([]);

  // vi → en
  const viTrigger = page.getByRole("button", { name: langAria.vi }).first();
  await viTrigger.click();
  await page.getByRole("menuitemradio", { name: /English/ }).click();
  await page.waitForTimeout(250);
  current = await scan(page);
  introduced = newViolations(baseline, current);
  if (introduced.length) {
    await info.attach("axe-after-vi-to-en.json", {
      body: JSON.stringify(introduced, null, 2),
      contentType: "application/json",
    });
  }
  expect(introduced, "new axe violations after switching back to en").toEqual([]);
});
