import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createProductionReadonlyPolicy,
  installProductionReadonlyGuard,
  shouldBlockProductionRequest,
  validateRollupAssetPathnames,
  validateWorkerIdentityPath,
} from "./helpers/production-readonly";

test.use({
  serviceWorkers: "allow",
  trace: "off",
  screenshot: "off",
  video: "off",
});

const WORKER_IDENTITY_PROTOCOL = "snote-sw-identity-v1";
const WORKER_IDENTITY_REQUEST = "snote:sw-identity:request:v1";
const WORKER_IDENTITY_RESPONSE = "snote:sw-identity:response:v1";

type DeployedServiceWorkerState = {
  activeScriptUrl: string | null;
  activeState: string | null;
  controllerScriptUrl: string | null;
  scope: string;
};

type ReleaseManifest = {
  buildId: string;
  deployedSha: string;
  rollupAssetPathnames: readonly string[];
  workerIdentityPath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateReleaseManifest(
  value: unknown,
  expectedBuildId: string,
  expectedDeployedSha: string,
): ReleaseManifest {
  if (!isRecord(value)) throw new Error("Invalid release manifest");
  expect(Object.keys(value).sort()).toEqual([
    "buildId",
    "builtAt",
    "deployedSha",
    "rollupAssetPathnames",
    "workerIdentityPath",
  ]);
  expect(value.buildId).toBe(expectedBuildId);
  expect(value.deployedSha).toBe(expectedDeployedSha);
  expect(value.builtAt).toEqual(expect.any(String));

  return {
    buildId: expectedBuildId,
    deployedSha: expectedDeployedSha,
    rollupAssetPathnames: validateRollupAssetPathnames(
      value.rollupAssetPathnames,
    ),
    workerIdentityPath: validateWorkerIdentityPath(value.workerIdentityPath),
  };
}

async function readTrustedLocalReleaseManifest(
  expectedBuildId: string,
  expectedDeployedSha: string,
): Promise<ReleaseManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile(resolve(process.cwd(), "dist/version.json"), "utf8"),
    );
  } catch {
    throw new Error("Trusted local release manifest is unavailable");
  }
  return validateReleaseManifest(
    parsed,
    expectedBuildId,
    expectedDeployedSha,
  );
}

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

async function requestActiveWorkerIdentity(page: Page): Promise<unknown> {
  return page.evaluate(
    ({ requestType, timeoutMs }) =>
      new Promise((resolveIdentity, rejectIdentity) => {
        const controller = navigator.serviceWorker.controller;
        if (!controller) {
          rejectIdentity(new Error("Active service worker controller is missing"));
          return;
        }

        const channel = new MessageChannel();
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          channel.port1.close();
          channel.port2.close();
          callback();
        };
        const timer = window.setTimeout(
          () =>
            finish(() =>
              rejectIdentity(
                new Error("Active service worker identity timed out"),
              ),
            ),
          timeoutMs,
        );

        channel.port1.onmessage = (event) =>
          finish(() => resolveIdentity(event.data));
        channel.port1.onmessageerror = () =>
          finish(() =>
            rejectIdentity(
              new Error("Active service worker identity was malformed"),
            ),
          );
        channel.port1.start();
        controller.postMessage({ type: requestType }, [channel.port2]);
      }),
    { requestType: WORKER_IDENTITY_REQUEST, timeoutMs: 5_000 },
  );
}

function expectActiveWorkerIdentity(
  identity: unknown,
  expectedBuildId: string,
  expectedDeployedSha: string,
): void {
  expect(identity).toEqual({
    type: WORKER_IDENTITY_RESPONSE,
    payload: {
      protocol: WORKER_IDENTITY_PROTOCOL,
      buildId: expectedBuildId,
      deployedSha: expectedDeployedSha,
    },
  });
}

test.describe("production PWA smoke (read-only)", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(
    process.env.POST_DEPLOY_SMOKE !== "1",
    "runs only from the authenticated post-deploy smoke workflow",
  );

  test("registers the deployed worker and serves offline privacy without writes", async ({
    page,
    context,
  }, testInfo) => {
    let guard:
      | Awaited<ReturnType<typeof installProductionReadonlyGuard>>
      | undefined;
    let offline = false;
    let cleanupFailure: Error | undefined;
    let primaryFailure: unknown;
    let auditFailure: unknown;

    try {
      const expectedBuildId = process.env.EXPECTED_BUILD_ID;
      const expectedDeployedSha = process.env.EXPECTED_DEPLOYED_SHA;
      if (!expectedBuildId) throw new Error("EXPECTED_BUILD_ID is required");
      if (!expectedDeployedSha || !/^[0-9a-f]{40}$/.test(expectedDeployedSha)) {
        throw new Error(
          "EXPECTED_DEPLOYED_SHA must be an exact lowercase commit SHA",
        );
      }

      const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
      if (!baseUrl) {
        throw new Error(
          "PLAYWRIGHT_BASE_URL is required for the production smoke",
        );
      }
      const trustedManifest = await readTrustedLocalReleaseManifest(
        expectedBuildId,
        expectedDeployedSha,
      );
      const policy = createProductionReadonlyPolicy(baseUrl, {
        rollupAssetPathnames: trustedManifest.rollupAssetPathnames,
        workerIdentityPath: trustedManifest.workerIdentityPath,
      });
      guard = await installProductionReadonlyGuard(context, policy);
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
      expect(versionResponse.headers()["cache-control"] ?? "").toMatch(
        /no-store|no-cache/i,
      );
      const version = validateReleaseManifest(
        await versionResponse.json(),
        expectedBuildId,
        expectedDeployedSha,
      );
      expect(version.deployedSha).toBe(expectedDeployedSha);
      expect(version.rollupAssetPathnames).toEqual(
        trustedManifest.rollupAssetPathnames,
      );
      expect(version.workerIdentityPath).toBe(
        trustedManifest.workerIdentityPath,
      );

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

      const [serviceWorker, navigationResponse] = await Promise.all([
        serviceWorkerCreated,
        page.goto("/privacy?v=legacy-noise&foo=bar", {
          waitUntil: "domcontentloaded",
        }),
      ]);
      expect(navigationResponse).not.toBeNull();
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
      expectActiveWorkerIdentity(
        await requestActiveWorkerIdentity(page),
        expectedBuildId,
        expectedDeployedSha,
      );
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
      offline = true;
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
      expectActiveWorkerIdentity(
        await requestActiveWorkerIdentity(page),
        expectedBuildId,
        expectedDeployedSha,
      );

      const offlineUrl = new URL(page.url());
      expect(offlineUrl.pathname).toBe("/privacy");
      expect(offlineUrl.searchParams.has("v")).toBe(false);
      expect(offlineUrl.searchParams.get("foo")).toBe("bar");
      expect([...offlineUrl.searchParams.keys()]).toEqual(["foo"]);
    } catch (error) {
      primaryFailure = error;
    } finally {
      if (offline) {
        try {
          await context.setOffline(false);
          offline = false;
        } catch {
          cleanupFailure = new Error(
            "Production smoke could not restore network state",
          );
        }
      }
      try {
        await context.close();
      } catch {
        cleanupFailure ??= new Error(
          "Production smoke context shutdown failed",
        );
      }
      try {
        await testInfo.attach("production-readonly-attempts.json", {
          body: JSON.stringify(guard?.attempts() ?? [], null, 2),
          contentType: "application/json",
        });
      } catch {
        auditFailure = new Error(
          "Production smoke could not attach sanitized audit evidence",
        );
      }
      try {
        guard?.assertNoWrites();
      } catch (error) {
        auditFailure ??= error;
      }
      try {
        expect(
          cleanupFailure,
          "production smoke network/context cleanup must succeed",
        ).toBeUndefined();
      } catch (error) {
        auditFailure ??= error;
      }
    }
    if (primaryFailure) throw primaryFailure;
    if (auditFailure) throw auditFailure;
  });
});
