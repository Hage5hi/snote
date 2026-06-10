// E2E: CommandPalette is lazily loaded. The `cmdk` bundle must NOT load on
// initial Home navigation, and pressing Ctrl/⌘+K must open the palette in a
// reasonable time even on a cold visit. Re-opening must be faster than the
// first open (no second network round-trip).
import { test, expect, type Page } from "@playwright/test";
import {
  buildArtifactName,
  buildRunId,
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

const CMDK_HINT_RE = /cmdk|CommandPaletteBody/i;

test.describe("CommandPalette — lazy chunk loading", () => {
  test("does not load cmdk chunk on cold Home, loads on first Ctrl+K", async ({ page }) => {
    await seed(page);

    const moduleRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.endsWith(".js") || url.includes("/@fs/") || url.includes("/src/")) {
        moduleRequests.push(url);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const preKeydown = moduleRequests.filter((u) => CMDK_HINT_RE.test(u));
    expect(preKeydown, `cmdk chunk loaded before Ctrl+K: ${preKeydown.join(", ")}`).toHaveLength(0);

    const moduleCountBefore = moduleRequests.length;
    const firstOpenMs = await page.evaluate(async () => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      // Wait for the dialog to appear in the DOM.
      const deadline = t0 + 5000;
      while (performance.now() < deadline) {
        if (document.querySelector("[cmdk-root], [role='dialog']")) return performance.now() - t0;
        await new Promise((r) => setTimeout(r, 16));
      }
      return -1;
    });
    expect(firstOpenMs).toBeGreaterThan(0);
    expect(firstOpenMs).toBeLessThan(3000); // generous; CI cold-start

    // After opening, at least one new module request must have happened
    // (the dynamic import). If not, the lazy split isn't actually working.
    await page.waitForTimeout(100);
    expect(moduleRequests.length).toBeGreaterThanOrEqual(moduleCountBefore + 1);

    // Close + reopen — second open should be fast (no chunk fetch).
    await page.keyboard.press("Escape");
    await expect(page.locator("[cmdk-root], [role='dialog']")).toBeHidden({ timeout: 2000 });

    const moduleCountMid = moduleRequests.length;
    const secondOpenMs = await page.evaluate(async () => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      const deadline = t0 + 2000;
      while (performance.now() < deadline) {
        if (document.querySelector("[cmdk-root], [role='dialog']")) return performance.now() - t0;
        await new Promise((r) => setTimeout(r, 16));
      }
      return -1;
    });
    expect(secondOpenMs).toBeGreaterThan(0);
    // Second open must not fetch additional code chunks.
    expect(moduleRequests.length).toBe(moduleCountMid);
    // And should be at least as fast as the first open.
    expect(secondOpenMs).toBeLessThanOrEqual(firstOpenMs + 50);
  });

  test("⌘+K opens the palette after F5 within budget (first + repeat)", async ({ page, context }, testInfo) => {
    // Playwright tracing: keep a screenshots+snapshots trace open for the
    // whole test. We attach it to the test report ONLY if a perf threshold
    // assertion fails — passing runs don't bloat artifacts.
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    let firstOpenMs = -1;
    let secondOpenMs = -1;
    let tracingStopped = false;
    // Embed test title + a unique run id into every artifact name/path so
    // multiple F5 reruns + retries produce distinct, easy-to-correlate files.
    const slug = slugifyTitle(testInfo.title);
    const runId = buildRunId(testInfo);
    const traceName = buildArtifactName(testInfo, "trace", runId);
    const summaryName = buildArtifactName(testInfo, "summary", runId);
    // Sanity-check the canonical pattern at runtime so a future helper
    // change can't silently produce CI artifacts we can't grep for.
    expect(traceName).toMatch(PERF_ARTIFACT_NAME_RE);
    expect(summaryName).toMatch(PERF_ARTIFACT_NAME_RE);
    expect(traceName).toContain(slug);
    expect(traceName).toContain(runId);
    const stopAndMaybeAttach = async (reason: string | null) => {
      if (tracingStopped) return;
      tracingStopped = true;
      const tracePath = testInfo.outputPath(traceName);
      await context.tracing.stop({ path: tracePath });
      if (reason) {
        expect(tracePath).toContain(slug);
        expect(tracePath).toContain(runId);
        await testInfo.attach(`${traceName} (${reason})`, {
          path: tracePath,
          contentType: "application/zip",
        });
        // Also attach a JSON summary so triage doesn't need to open the trace.
        await testInfo.attach(summaryName, {
          body: JSON.stringify({ reason, testTitle: testInfo.title, runId, firstOpenMs, secondOpenMs }, null, 2),
          contentType: "application/json",
        });
      }
    };

    try {
      await seed(page);
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.reload();
      await page.waitForLoadState("networkidle");

      async function measureOpen(): Promise<number> {
        return page.evaluate(async () => {
          const t0 = performance.now();
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
          const deadline = t0 + 5000;
          while (performance.now() < deadline) {
            if (document.querySelector("[cmdk-root], [role='dialog']")) return performance.now() - t0;
            await new Promise((r) => setTimeout(r, 16));
          }
          return -1;
        });
      }

      firstOpenMs = await measureOpen();
      if (firstOpenMs <= 0 || firstOpenMs >= 3000) {
        await stopAndMaybeAttach(`first-open ${firstOpenMs}ms (budget <3000ms)`);
      }
      expect(firstOpenMs).toBeGreaterThan(0);
      expect(firstOpenMs, `first ⌘+K after F5 too slow: ${firstOpenMs}ms`).toBeLessThan(3000);

      await page.keyboard.press("Escape");
      await expect(page.locator("[cmdk-root], [role='dialog']")).toBeHidden({ timeout: 2000 });

      secondOpenMs = await measureOpen();
      if (secondOpenMs <= 0 || secondOpenMs >= 500) {
        await stopAndMaybeAttach(`second-open ${secondOpenMs}ms (budget <500ms)`);
      }
      expect(secondOpenMs).toBeGreaterThan(0);
      expect(secondOpenMs, `second ⌘+K too slow: ${secondOpenMs}ms`).toBeLessThan(500);
    } catch (err) {
      // Any assertion or runtime failure → flush the trace for triage.
      await stopAndMaybeAttach(`error: ${(err as Error).message?.slice(0, 80) ?? "unknown"}`);
      throw err;
    } finally {
      // Discard the trace when everything passed (no artifact bloat).
      if (!tracingStopped) {
        tracingStopped = true;
        await context.tracing.stop();
      }
    }
  });
});


