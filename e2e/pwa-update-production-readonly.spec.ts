import { expect, test } from "@playwright/test";
import {
  getHardReloadCount,
  installPwaUpdateMock,
  waitForPwaUpdaterReady,
} from "./helpers/pwa-update-mock";
import {
  createProductionReadonlyPolicy,
  installProductionReadonlyGuard,
  shouldBlockProductionRequest,
} from "./helpers/production-readonly";

test.use({
  serviceWorkers: "block",
  trace: "off",
  screenshot: "off",
  video: "off",
});

test.describe("production PWA smoke (read-only)", () => {
  test.skip(
    process.env.POST_DEPLOY_SMOKE !== "1",
    "runs only from the authenticated post-deploy smoke workflow",
  );

  test("updates the public privacy route without creating notes or sockets", async ({
    page,
    context,
  }, testInfo) => {
    const expectedBuildId = process.env.EXPECTED_BUILD_ID;
    const expectedDeployedSha = process.env.EXPECTED_DEPLOYED_SHA;
    expect(expectedBuildId, "EXPECTED_BUILD_ID is required").toBeTruthy();
    expect(expectedDeployedSha, "EXPECTED_DEPLOYED_SHA is required").toMatch(
      /^[0-9a-f]{40}$/,
    );

    const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
    if (!baseUrl) {
      throw new Error("PLAYWRIGHT_BASE_URL is required for the production smoke");
    }
    const policy = createProductionReadonlyPolicy(baseUrl);
    const guard = await installProductionReadonlyGuard(page, policy);
    expect(context.serviceWorkers()).toEqual([]);

    const versionUrl = new URL(
      "/version.json",
      policy.allowedOrigin,
    ).toString();
    expect(shouldBlockProductionRequest(versionUrl, "GET", policy)).toBe(false);
    const versionResponse = await page.request.get(versionUrl, {
      maxRedirects: 0,
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    });
    expect(versionResponse.status()).toBe(200);
    expect(versionResponse.url()).toBe(versionUrl);
    expect(versionResponse.headers()).not.toHaveProperty("location");
    // The request itself is explicitly no-store/no-cache. Providers may
    // answer with either directive while the Worker is the production
    // response-policy source of truth.
    expect(versionResponse.headers()["cache-control"] ?? "").toMatch(
      /no-store|no-cache/i,
    );
    const version = (await versionResponse.json()) as {
      buildId?: unknown;
      deployedSha?: unknown;
    };
    expect(version.buildId).toBe(expectedBuildId);
    expect(version.deployedSha).toBe(expectedDeployedSha);

    await installPwaUpdateMock(page, {
      fromBuildId: `${expectedBuildId}-previous`,
      toBuildId: expectedBuildId,
    });
    await page.goto("/privacy?v=legacy-noise&foo=bar", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Privacy Policy" }),
    ).toBeVisible();
    await waitForPwaUpdaterReady(page, testInfo);
    await expect(page.getByText("New version available")).toBeVisible({
      timeout: 5_000,
    });

    await page.getByRole("button", { name: /^Update$/ }).click();
    for (let i = 0; i < 4; i += 1) {
      await page
        .getByRole("button", { name: /^Update(?:…|\.\.\.)?$/ })
        .click({ force: true })
        .catch(() => {});
    }

    await expect.poll(() => getHardReloadCount(page)).toBe(1);
    const updatedUrl = new URL(page.url());
    expect(updatedUrl.pathname).toBe("/privacy");
    expect(updatedUrl.searchParams.has("v")).toBe(false);
    expect(updatedUrl.searchParams.get("foo")).toBe("bar");
    expect([...updatedUrl.searchParams.keys()]).toEqual(["foo"]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Privacy Policy" }),
    ).toBeVisible();
    const reloadedUrl = new URL(page.url());
    expect(reloadedUrl.pathname).toBe("/privacy");
    expect(reloadedUrl.searchParams.has("v")).toBe(false);
    expect(reloadedUrl.searchParams.get("foo")).toBe("bar");
    expect([...reloadedUrl.searchParams.keys()]).toEqual(["foo"]);

    await testInfo.attach("production-readonly-attempts.json", {
      body: JSON.stringify(guard.attempts(), null, 2),
      contentType: "application/json",
    });
    guard.assertNoWrites();
  });
});
