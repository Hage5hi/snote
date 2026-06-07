// E2E meta-guardrail: the perf-tracing logic in command-palette-lazy.spec.ts
// must ONLY attach a Playwright trace zip + JSON summary when a render budget
// is exceeded. On a passing run we must upload zero artifacts (no CI bloat).
//
// We re-implement the exact attach-gating pattern with a configurable budget
// so we can drive both branches deterministically:
//   - budget = 0ms   → first open always exceeds → expect attachments
//   - budget = huge  → never exceeds            → expect zero attachments
import { test, expect, type Page, type TestInfo, type BrowserContext } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";

async function seed(page: Page) {
  await page.addInitScript(
    ({ lang, ip }) => {
      localStorage.setItem(lang, "en");
      localStorage.setItem(ip, "1");
    },
    { lang: LANG_KEY, ip: IP_DETECTED_KEY },
  );
}

async function measureFirstOpen(page: Page): Promise<number> {
  await seed(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(async () => {
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    const deadline = t0 + 5000;
    while (performance.now() < deadline) {
      if (document.querySelector("[cmdk-root], [role='dialog']")) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 16));
    }
    return -1;
  });
}

async function runWithBudget(
  page: Page,
  context: BrowserContext,
  testInfo: TestInfo,
  budgetMs: number,
) {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const openedMs = await measureFirstOpen(page);
  const exceeded = openedMs <= 0 || openedMs >= budgetMs;
  if (exceeded) {
    const tracePath = testInfo.outputPath(`cmdk-perf-${Date.now()}.zip`);
    await context.tracing.stop({ path: tracePath });
    await testInfo.attach(`cmdk-perf-trace (budget ${budgetMs}ms)`, {
      path: tracePath,
      contentType: "application/zip",
    });
    await testInfo.attach("cmdk-perf-summary.json", {
      body: JSON.stringify({ budgetMs, openedMs }, null, 2),
      contentType: "application/json",
    });
  } else {
    await context.tracing.stop(); // discard
  }
  return { openedMs, exceeded };
}

test.describe("CommandPalette perf — attachment gating", () => {
  test("attaches trace zip + JSON summary when render exceeds budget", async ({ page, context }, testInfo) => {
    const before = testInfo.attachments.length;
    const { exceeded } = await runWithBudget(page, context, testInfo, /* budgetMs */ 0);
    expect(exceeded, "budget=0 must always be exceeded").toBe(true);

    const added = testInfo.attachments.slice(before);
    const hasZip = added.some((a) => a.contentType === "application/zip");
    const hasJson = added.some((a) => a.name === "cmdk-perf-summary.json");
    expect(hasZip, "missing trace zip attachment on over-budget run").toBe(true);
    expect(hasJson, "missing JSON summary attachment on over-budget run").toBe(true);
  });

  test("attaches nothing when render stays within budget", async ({ page, context }, testInfo) => {
    const before = testInfo.attachments.length;
    const { exceeded } = await runWithBudget(page, context, testInfo, /* budgetMs */ 60_000);
    expect(exceeded, "budget=60s should not be exceeded on any reasonable CI").toBe(false);

    const added = testInfo.attachments.slice(before);
    expect(added, `unexpected artifacts uploaded on passing run: ${added.map((a) => a.name).join(", ")}`).toEqual([]);
  });
});
