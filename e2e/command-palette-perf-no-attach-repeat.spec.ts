// E2E: when CommandPalette render stays within budget, repeated runs of the
// SAME budget must never attach a trace zip or a cmdk-perf-summary JSON to
// the test report. Guards against a regression where "passing" runs would
// still upload artifacts and bloat CI storage.
//
// Also asserts that any artifact name/path produced on the over-budget branch
// embeds both the test title (slug) and a unique run id so multiple F5 reruns
// are easy to correlate from the CI artifacts pane.
import { test, expect, type Page, type TestInfo, type BrowserContext } from "@playwright/test";
import {
  buildArtifactName,
  slugifyTitle,
  PERF_ARTIFACT_NAME_RE,
} from "./helpers/perf-artifact-name";

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
  iter: number,
) {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const openedMs = await measureFirstOpen(page);
  const exceeded = openedMs <= 0 || openedMs >= budgetMs;
  const slug = slugifyTitle(testInfo.title);
  // Custom suffix folds in the iteration count so within-test repeats are
  // distinguishable in CI without losing the canonical worker-retry prefix.
  const runId = `${testInfo.workerIndex}-${testInfo.retry}-iter${iter}-${Date.now()}`;
  const traceName = buildArtifactName(testInfo, "trace", runId);
  const summaryName = buildArtifactName(testInfo, "summary", runId);
  if (exceeded) {
    const tracePath = testInfo.outputPath(traceName);
    await context.tracing.stop({ path: tracePath });
    await testInfo.attach(`${traceName} (budget ${budgetMs}ms)`, {
      path: tracePath,
      contentType: "application/zip",
    });
    await testInfo.attach(summaryName, {
      body: JSON.stringify({ budgetMs, openedMs, testTitle: testInfo.title, runId }, null, 2),
      contentType: "application/json",
    });
    return { exceeded, openedMs, tracePath, runId, slug };
  }
  await context.tracing.stop(); // discard
  return { exceeded, openedMs, tracePath: null, runId, slug };
}

test.describe("CommandPalette perf — repeated within-budget runs upload no artifacts", () => {
  test("3 repeats at a generous budget produce zero attachments per run", async ({ page, context }, testInfo) => {
    for (let i = 1; i <= 3; i++) {
      const before = testInfo.attachments.length;
      const { exceeded } = await runWithBudget(page, context, testInfo, 60_000, i);
      expect(exceeded, `iter ${i}: 60s budget should not be exceeded`).toBe(false);
      const added = testInfo.attachments.slice(before);
      expect(
        added,
        `iter ${i}: unexpected artifacts on passing run: ${added.map((a) => a.name).join(", ")}`,
      ).toEqual([]);
    }
  });

  test("over-budget artifacts always embed test-title + run-id in name and path", async ({ page, context }, testInfo) => {
    const before = testInfo.attachments.length;
    const { exceeded, tracePath, slug, runId } = await runWithBudget(page, context, testInfo, /* budget */ 0, 1);
    expect(exceeded, "budget=0 must be exceeded").toBe(true);
    expect(tracePath, "tracePath missing").toBeTruthy();
    expect(tracePath!, `tracePath lacks slug "${slug}": ${tracePath}`).toContain(slug);
    expect(tracePath!, `tracePath lacks runId "${runId}": ${tracePath}`).toContain(runId);

    const added = testInfo.attachments.slice(before);
    const zip = added.find((a) => a.contentType === "application/zip");
    const json = added.find((a) => a.contentType === "application/json");
    expect(zip, "trace zip not attached").toBeTruthy();
    expect(json, "JSON summary not attached").toBeTruthy();
    expect(zip!.name, `zip name lacks slug: ${zip!.name}`).toContain(slug);
    expect(zip!.name, `zip name lacks runId: ${zip!.name}`).toContain(runId);
    expect(json!.name, `json name lacks slug: ${json!.name}`).toContain(slug);
    expect(json!.name, `json name lacks runId: ${json!.name}`).toContain(runId);
    // Both attachment names must conform to the shared canonical pattern.
    expect(zip!.name, `zip name fails canonical pattern: ${zip!.name}`).toMatch(PERF_ARTIFACT_NAME_RE);
    expect(json!.name, `json name fails canonical pattern: ${json!.name}`).toMatch(PERF_ARTIFACT_NAME_RE);
  });
});
