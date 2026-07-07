// E2E: PWA update readiness gate fails fast when the version poller stalls.
// Uses a huge initialPollMs so `__SNOTE_PWA_UPDATE_STATE__.lastRemoteBuildId`
// never populates; waitForPwaUpdaterReady should throw within its timeout and
// attach `pwa-updater-not-ready.json` to the test result.

import { test, expect } from "@playwright/test";
import { installPwaUpdateMock, waitForPwaUpdaterReady } from "./helpers/pwa-update-mock";

test("readiness gate throws and attaches pwa-updater-not-ready.json when poller stalls", async ({ page }, testInfo) => {
  await installPwaUpdateMock(page, {
    fromBuildId: "build-stall-1",
    toBuildId: "build-stall-2",
    // Effectively disable polling so lastRemoteBuildId never populates.
    initialPollMs: 10_000_000,
    pollIntervalMs: 10_000_000,
  });
  await page.goto("/");

  await expect(waitForPwaUpdaterReady(page, testInfo, 500)).rejects.toThrow(
    /version poller never populated/,
  );

  const attached = testInfo.attachments.find((a) => a.name === "pwa-updater-not-ready.json");
  expect(attached, "expected pwa-updater-not-ready.json attachment").toBeDefined();
  const body = attached?.body?.toString("utf8") ?? "";
  const parsed = JSON.parse(body) as Record<string, unknown>;
  expect(parsed).toHaveProperty("lastState");
  expect(parsed).toHaveProperty("swState");
  expect(parsed).toHaveProperty("timeoutMs", 500);
});
