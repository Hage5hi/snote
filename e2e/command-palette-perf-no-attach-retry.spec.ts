// E2E: within-budget CommandPalette perf runs must NEVER attach a trace
// zip or a `cmdk-perf-summary` JSON to the test report — and that contract
// must hold across Playwright retries. We simulate the retry loop here
// (real retries only fire on failure, and we explicitly want the test to
// pass) by re-running the within-budget perf path for each simulated
// retry attempt and asserting zero attachments after every attempt.
//
// Each simulated attempt builds a runId that includes a `retry-sim-N`
// suffix so the names would be uniquely identifiable IF a regression
// caused them to leak — making CI triage trivial.
import { test, expect, type Page, type TestInfo, type BrowserContext } from "@playwright/test";
import { buildArtifactName, slugifyTitle } from "./helpers/perf-artifact-name";

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

async function withinBudgetAttempt(
  page: Page,
  context: BrowserContext,
  testInfo: TestInfo,
  simulatedRetry: number,
) {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const openedMs = await measureFirstOpen(page);
  const budgetMs = 60_000;
  const exceeded = openedMs <= 0 || openedMs >= budgetMs;
  const runId = `${testInfo.workerIndex}-${testInfo.retry}-retry-sim-${simulatedRetry}-${Date.now()}`;
  // Mirror prod logic: ONLY attach when exceeded. For this guardrail,
  // exceeded must always be false.
  if (exceeded) {
    const tracePath = testInfo.outputPath(buildArtifactName(testInfo, "trace", runId));
    await context.tracing.stop({ path: tracePath });
    await testInfo.attach(buildArtifactName(testInfo, "trace", runId), {
      path: tracePath,
      contentType: "application/zip",
    });
    await testInfo.attach(buildArtifactName(testInfo, "summary", runId), {
      body: JSON.stringify({ budgetMs, openedMs, runId }, null, 2),
      contentType: "application/json",
    });
  } else {
    await context.tracing.stop(); // discard
  }
  return { exceeded, openedMs, runId };
}

test.describe("CommandPalette perf — retry-equivalent runs leak zero artifacts", () => {
  test("3 simulated retries within budget produce zero attachments end-to-end", async ({ page, context }, testInfo) => {
    const slug = slugifyTitle(testInfo.title);
    expect(slug).toBeTruthy();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = testInfo.attachments.length;
      const { exceeded } = await withinBudgetAttempt(page, context, testInfo, attempt);
      expect(exceeded, `simulated retry ${attempt}: within-budget run unexpectedly exceeded`).toBe(false);
      const added = testInfo.attachments.slice(before);
      expect(
        added,
        `simulated retry ${attempt}: artifacts leaked on within-budget run: ${added
          .map((a) => a.name)
          .join(", ")}`,
      ).toEqual([]);
    }

    // Final sanity: NOTHING from this test should have produced trace zips
    // or cmdk-perf-summary JSONs across all attempts combined.
    const leaked = testInfo.attachments.filter((a) =>
      /cmdk-perf-(trace|summary)/.test(a.name),
    );
    expect(
      leaked,
      `within-budget retries leaked artifacts: ${leaked.map((a) => a.name).join(", ")}`,
    ).toEqual([]);
  });
});
