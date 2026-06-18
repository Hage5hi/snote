import { defineConfig } from "@playwright/test";

// Extension E2E suite. Separate from the root playwright.config.ts so it
// doesn't run in CI by default. Run locally with:
//   bunx playwright test --config=e2e-extension/playwright.config.ts
//
// Requires a real (headed) Chromium with the extension loaded as
// persistentContext. The Alt+S keyboard command can't be triggered by
// Playwright (commands API needs a real user gesture), so the Alt+S spec
// drives chrome.sidePanel.open() directly via service worker eval — the
// equivalent code path the command handler runs.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
