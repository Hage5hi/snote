import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config — runs against `bun run dev` (Vite).
// Keep this scoped to /e2e so it never picks up Vitest unit tests under /src.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // language tests touch shared localStorage
  forbidOnly: !!process.env.CI,
  // Pixel-diff / hit-test specs can flake on shared CI runners (GPU jitter,
  // font-hinting changes, slow scene first-frame). Retry up to 2x in CI so a
  // single transient blip doesn't turn a green branch red — real regressions
  // still fail because they reproduce on every retry. Locally the default is
  // 0 so a flake is noisy and gets fixed at the source.
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["list"], ["json", { outputFile: "test-results/e2e-results.json" }]]
    : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    // Capture a fresh screenshot on every failure so the CI artifact bundle
    // includes the exact pixels that tripped the assertion (mask coverage,
    // flicker, axe hit-test debug overlays, etc.).
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Tunable thresholds for in-spec image diffs (toMatchSnapshot uses these).
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
    toMatchSnapshot: { maxDiffPixelRatio: 0.02 },
  },
  // Cross-browser matrix: filter via `--project=<name>` or PLAYWRIGHT_PROJECT.
  // CI runs all three; local dev defaults to chromium only.
  projects: (() => {
    const all = [
      { name: "chromium", use: { ...devices["Desktop Chrome"] } },
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
