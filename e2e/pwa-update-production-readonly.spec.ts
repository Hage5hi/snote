import { expect, test, type Page } from "@playwright/test";
import {
  createProductionReadonlyPolicy,
  installProductionReadonlyGuard,
  shouldBlockProductionRequest,
} from "./helpers/production-readonly";

test.use({
  serviceWorkers: "allow",
  trace: "off",
  screenshot: "off",
  video: "off",
});

type DeployedServiceWorkerState = {
  activeScriptUrl: string | null;
  activeState: string | null;
  controllerScriptUrl: string | null;
  scope: string;
};

async function readDeployedServiceWorkerState(
  page: Page,
): Promise<DeployedServiceWorkerState> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      activeScriptUrl: registration.active?.scriptURL ?? null,
      activeState: registration.active?.state ?? null,
      controllerScriptUrl:
        navigator.serviceWorker.controller?.scriptURL ?? null,
      scope: registration.scope,
    };
  });
}

test.describe("production PWA smoke (read-only)", () => {
  test.skip(
    process.env.POST_DEPLOY_SMOKE !== "1",
    "runs only from the authenticated post-deploy smoke workflow",
  );

  test("registers the deployed worker and serves offline privacy without writes", async ({
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
    const guard = await installProductionReadonlyGuard(context, policy);
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

    const expectedServiceWorkerUrl = new URL(
      "/sw.js",
      policy.allowedOrigin,
    ).toString();
    const expectedServiceWorkerScope = new URL(
      "/",
      policy.allowedOrigin,
    ).toString();
    const serviceWorkerCreated = context.waitForEvent("serviceworker", {
      timeout: 30_000,
    });

    await page.goto("/privacy?v=legacy-noise&foo=bar", {
      waitUntil: "domcontentloaded",
    });
    const serviceWorker = await serviceWorkerCreated;
    expect(serviceWorker.url()).toBe(expectedServiceWorkerUrl);
    await expect(
      page.getByRole("heading", { name: "Privacy Policy" }),
    ).toBeVisible();

    await page.waitForFunction(
      async ({ expectedScriptUrl, expectedScope }) => {
        const registration = await navigator.serviceWorker.ready;
        const active = registration.active;
        return Boolean(
          active &&
            active.state === "activated" &&
            active.scriptURL === expectedScriptUrl &&
            registration.scope === expectedScope &&
            navigator.serviceWorker.controller?.scriptURL ===
              expectedScriptUrl,
        );
      },
      {
        expectedScriptUrl: expectedServiceWorkerUrl,
        expectedScope: expectedServiceWorkerScope,
      },
      { timeout: 30_000 },
    );

    await expect
      .poll(async () => readDeployedServiceWorkerState(page))
      .toEqual({
        activeScriptUrl: expectedServiceWorkerUrl,
        activeState: "activated",
        controllerScriptUrl: expectedServiceWorkerUrl,
        scope: expectedServiceWorkerScope,
      });
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          pathname: url.pathname,
          hasLegacyVersion: url.searchParams.has("v"),
          unrelatedValue: url.searchParams.get("foo"),
          keys: [...url.searchParams.keys()],
        };
      })
      .toEqual({
        pathname: "/privacy",
        hasLegacyVersion: false,
        unrelatedValue: "bar",
        keys: ["foo"],
      });

    await context.setOffline(true);
    try {
      const offlineResponse = await page.reload({
        waitUntil: "domcontentloaded",
      });
      if (!offlineResponse) {
        throw new Error("offline privacy reload did not return a response");
      }
      expect(offlineResponse.fromServiceWorker()).toBe(true);
      await expect(
        page.getByRole("heading", { name: "Privacy Policy" }),
      ).toBeVisible();
      await expect
        .poll(async () => readDeployedServiceWorkerState(page))
        .toEqual({
          activeScriptUrl: expectedServiceWorkerUrl,
          activeState: "activated",
          controllerScriptUrl: expectedServiceWorkerUrl,
          scope: expectedServiceWorkerScope,
        });

      const offlineUrl = new URL(page.url());
      expect(offlineUrl.pathname).toBe("/privacy");
      expect(offlineUrl.searchParams.has("v")).toBe(false);
      expect(offlineUrl.searchParams.get("foo")).toBe("bar");
      expect([...offlineUrl.searchParams.keys()]).toEqual(["foo"]);
    } finally {
      await context.setOffline(false);
    }

    await testInfo.attach("production-readonly-attempts.json", {
      body: JSON.stringify(guard.attempts(), null, 2),
      contentType: "application/json",
    });
    guard.assertNoWrites();
  });
});
