// Verifies that when VITE_PWA_READINESS_REPORTER_ENABLED is unset (default
// OFF in .env.example), `installPwaReadinessInvalidReporter` is a no-op:
// the sink never receives `snote:pwa-readiness-invalid` events, and the
// resolved env config reports `enabled: false`.
import { test, expect } from "@playwright/test";

test("reporter is disabled by default when env flag is off", async ({ page }) => {
  await page.goto("/");

  // Wait for DEV panel to call exposeReadinessValidatorForE2E.
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __SNOTE_PWA_READINESS_INSTALL_REPORTER__?: unknown })
        .__SNOTE_PWA_READINESS_INSTALL_REPORTER__ === "function",
  );

  const env = await page.evaluate(() =>
    (
      window as unknown as {
        __SNOTE_PWA_READINESS_REPORTER_ENV__: () => { enabled: boolean; sampleRate: number };
      }
    ).__SNOTE_PWA_READINESS_REPORTER_ENV__(),
  );
  expect(env.enabled).toBe(false);

  const sinkCalls = await page.evaluate(() => {
    const w = window as unknown as {
      __sinkCalls?: number;
      __SNOTE_PWA_READINESS_INSTALL_REPORTER__: (opts: {
        sampleRate?: number;
        sink?: (d: unknown) => void;
        force?: boolean;
      }) => () => void;
    };
    w.__sinkCalls = 0;
    // NOT forced — must be a no-op because env flag is off.
    const off = w.__SNOTE_PWA_READINESS_INSTALL_REPORTER__({
      sampleRate: 1,
      sink: () => {
        w.__sinkCalls = (w.__sinkCalls ?? 0) + 1;
      },
    });
    window.dispatchEvent(
      new CustomEvent("snote:pwa-readiness-invalid", {
        detail: {
          field: "reloadStrategy",
          path: "reloadStrategy",
          reason: "must be 'waiting-sw'|'hard'|null",
          received: "teleport",
        },
      }),
    );
    off();
    return w.__sinkCalls ?? 0;
  });

  expect(sinkCalls).toBe(0);
});
