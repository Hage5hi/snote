import { defineConfig, devices } from "@playwright/test";

const PWA_TRANSITION_ORIGIN = "http://127.0.0.1:4178";
const PWA_TRANSITION_CONTROL_TOKEN =
  "snote-pwa-transition-local-control-v1";

export default defineConfig({
  testDir: "./e2e-pwa-transition",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        [
          "html",
          {
            outputFolder: "playwright-report/pwa-transition",
            open: "never",
          },
        ],
      ]
    : "list",
  outputDir: "test-results/pwa-transition",
  use: {
    baseURL: PWA_TRANSITION_ORIGIN,
    locale: "en-US",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? {
              launchOptions: {
                executablePath:
                  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
              },
            }
          : {}),
      },
    },
  ],
  webServer: {
    command: "bun run scripts/pwa-transition-server.ts",
    env: {
      SNOTE_PWA_TRANSITION_CONTROL_TOKEN:
        PWA_TRANSITION_CONTROL_TOKEN,
      SNOTE_PWA_TRANSITION_PORT: "4178",
    },
    url: `${PWA_TRANSITION_ORIGIN}/__pwa-transition/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
