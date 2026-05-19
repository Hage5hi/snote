import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config — runs against `bun run dev` (Vite).
// Keep this scoped to /e2e so it never picks up Vitest unit tests under /src.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // language tests touch shared localStorage
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
