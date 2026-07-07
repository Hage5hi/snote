import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config — runs against `bun run dev` (Vite).
// Keep this scoped to /e2e so it never picks up Vitest unit tests under /src.

// Pixel-diff threshold — overridable per-run via PIXEL_DIFF_RATIO so the
// same config works for "tighten the gate" (=0.005) and "accept new
// baseline" (=0.05) without editing source.
const PIXEL_DIFF_RATIO = (() => {
  const v = Number(process.env.PIXEL_DIFF_RATIO);
  return Number.isFinite(v) && v >= 0 ? v : 0.02;
})();

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // language tests touch shared localStorage
  forbidOnly: !!process.env.CI,
  // Global retries are 0 — flake hides real regressions. The pixel-diff and
  // hit-test specs that legitimately need GPU/font-jitter tolerance opt in
  // locally via `test.describe.configure({ retries: ... })`. This keeps
  // logic/i18n suites strict while still catching genuine pixel regressions
  // (which reproduce on every retry).
  retries: 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["list"], ["json", { outputFile: "test-results/e2e-results.json" }]]
    : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Tunable thresholds for in-spec image diffs (toMatchSnapshot uses these).
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: PIXEL_DIFF_RATIO },
    toMatchSnapshot: { maxDiffPixelRatio: PIXEL_DIFF_RATIO },
  },

  // Cross-browser matrix: filter via `--project=<name>` or PLAYWRIGHT_PROJECT.
  // CI runs all three; local dev defaults to chromium only.
  projects: (() => {
    const all = [
      {
        name: "chromium",
        use: {
          ...devices["Desktop Chrome"],
          ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
        },
      },
      { name: "firefox", use: { ...devices["Desktop Firefox"] } },
      { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ];
    if (process.env.PLAYWRIGHT_PROJECT) {
      return all.filter((p) => p.name === process.env.PLAYWRIGHT_PROJECT);
    }
    return process.env.CI ? all : [all[0]];
  })(),
  webServer: {
    command: "bun run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
