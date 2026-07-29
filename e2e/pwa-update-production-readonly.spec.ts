import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  startChromiumWorkerAttestation,
  type ChromiumWorkerAttestation,
  type TrustedChromiumWorkerArtifact,
} from "./helpers/chromium-worker-attestation";
import {
  assertTrustedWorkerArtifactBody,
  assertTrustedReleaseManifestMatch,
  createTrustedWorkerArtifactDigest,
  createProductionReadonlyPolicy,
  fetchBoundedReadonlyResource,
  installProductionReadonlyGuard,
  MAX_REMOTE_VERSION_BODY_BYTES,
  validateActiveWorkerIdentity,
  validateProductionReleaseManifest,
  validateTrustedServiceWorkerArtifacts,
  type ProductionReadonlyPolicy,
  type ProductionReleaseManifest,
  type TrustedWorkerArtifactDigest,
} from "./helpers/production-readonly";

test.use({
  serviceWorkers: "allow",
  trace: "off",
  screenshot: "off",
  video: "off",
});

const WORKER_IDENTITY_REQUEST = "snote:sw-identity:request:v1";
const PRODUCTION_SMOKE_PRIMARY_STAGES = new Set([
  "initialization",
  "environment",
  "trusted-local-artifacts",
  "remote-release-manifest",
  "remote-worker-artifacts",
  "worker-registration",
  "online-worker-verification",
  "offline-worker-verification",
]);
const PRODUCTION_SMOKE_CLEANUP_CODES = new Set([
  "isolate-network",
  "worker-attestation",
  "readonly-guard",
  "close-context",
]);
const PRODUCTION_SMOKE_AUDIT_CODES = new Set([
  "attach-evidence",
  "request-audit",
]);

function safeFailureCode(
  value: unknown,
  allowed: ReadonlySet<string>,
): string {
  return typeof value === "string" && allowed.has(value) ? value : "unknown";
}

export function createProductionSmokeFailure(options: {
  primaryStage?: unknown;
  cleanupCode?: unknown;
  auditCode?: unknown;
}): Error | null {
  const codes: string[] = [];
  if (options.primaryStage !== undefined) {
    codes.push(
      `primary:${safeFailureCode(
        options.primaryStage,
        PRODUCTION_SMOKE_PRIMARY_STAGES,
      )}`,
    );
  }
  if (options.cleanupCode !== undefined) {
    codes.push(
      `cleanup:${safeFailureCode(
        options.cleanupCode,
        PRODUCTION_SMOKE_CLEANUP_CODES,
      )}`,
    );
  }
  if (options.auditCode !== undefined) {
    codes.push(
      `audit:${safeFailureCode(
        options.auditCode,
        PRODUCTION_SMOKE_AUDIT_CODES,
      )}`,
    );
  }
  return codes.length > 0
    ? new Error(`Production PWA smoke failed [${codes.join(", ")}]`)
    : null;
}

async function readTrustedLocalReleaseManifest(
  expectedBuildId: string,
  expectedDeployedSha: string,
): Promise<ProductionReleaseManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile(resolve(process.cwd(), "dist/version.json"), "utf8"),
    );
  } catch {
    throw new Error("Trusted local release manifest is unavailable");
  }
  return validateProductionReleaseManifest(
    parsed,
    expectedBuildId,
    expectedDeployedSha,
  );
}

async function readTrustedLocalServiceWorkerArtifacts(
  workerIdentityPath: string,
) {
  try {
    const distPath = resolve(process.cwd(), "dist");
    const [serviceWorkerBody, fileNames] = await Promise.all([
      readFile(resolve(distPath, "sw.js")),
      readdir(distPath),
    ]);
    const workboxFileNames = fileNames.filter((fileName) =>
      /^workbox-[a-f0-9]{8}\.js$/.test(fileName),
    );
    const parsed = validateTrustedServiceWorkerArtifacts(
      serviceWorkerBody.toString("utf8"),
      workboxFileNames,
      workerIdentityPath,
    );
    const [identityBody, workboxBody] = await Promise.all([
      readFile(resolve(distPath, workerIdentityPath.slice(1))),
      readFile(resolve(distPath, parsed.workboxPathname.slice(1))),
    ]);
    return Object.freeze({
      ...parsed,
      artifacts: Object.freeze([
        Object.freeze({
          ...createTrustedWorkerArtifactDigest("/sw.js", serviceWorkerBody),
          source: serviceWorkerBody.toString("utf8"),
        }),
        Object.freeze({
          ...createTrustedWorkerArtifactDigest(
            workerIdentityPath,
            identityBody,
          ),
          source: identityBody.toString("utf8"),
        }),
        Object.freeze({
          ...createTrustedWorkerArtifactDigest(
            parsed.workboxPathname,
            workboxBody,
          ),
          source: workboxBody.toString("utf8"),
        }),
      ]),
    });
  } catch {
    throw new Error("Trusted local service worker artifact is unavailable");
  }
}

async function verifyRemoteWorkerArtifacts(
  policy: ProductionReadonlyPolicy,
  artifacts: readonly TrustedWorkerArtifactDigest[],
): Promise<void> {
  for (const trusted of artifacts) {
    const artifactUrl = new URL(
      trusted.pathname,
      policy.allowedOrigin,
    ).toString();
    let body: Uint8Array;
    try {
      body = (
        await fetchBoundedReadonlyResource(
          artifactUrl,
          policy,
          trusted.byteLength,
        )
      ).body;
    } catch {
      throw new Error("Production worker artifact response failed validation");
    }
    assertTrustedWorkerArtifactBody(body, trusted);
  }
}

async function hasExpectedServiceWorkerState(
  page: Page,
  expectedScriptUrl: string,
  expectedScope: string,
): Promise<boolean> {
  return page.evaluate(
    async ({ scriptUrl, scope }) => {
      const registration =
        await navigator.serviceWorker.getRegistration("/");
      return Boolean(
        registration &&
          registration.active?.scriptURL === scriptUrl &&
          registration.active.state === "activated" &&
          navigator.serviceWorker.controller?.scriptURL === scriptUrl &&
          registration.scope === scope,
      );
    },
    { scriptUrl: expectedScriptUrl, scope: expectedScope },
  );
}

async function hasExpectedPrivacyUrl(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    return (
      url.pathname === "/privacy" &&
      !url.searchParams.has("v") &&
      url.searchParams.get("foo") === "bar" &&
      [...url.searchParams.keys()].length === 1
    );
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

test.describe("production PWA smoke (read-only)", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "exact loaded service-worker source attestation is Chromium-only",
  );
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
    let workerAttestation: ChromiumWorkerAttestation | undefined;
    let cleanupFailureCode: string | undefined;
    let primaryFailure = false;
    let auditFailureCode: string | undefined;
    let primaryStage = "initialization";
    let networkIsolated = false;
    let contextClosed = false;

    try {
      primaryStage = "environment";
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
      primaryStage = "trusted-local-artifacts";
      const trustedManifest = await readTrustedLocalReleaseManifest(
        expectedBuildId,
        expectedDeployedSha,
      );
      const trustedWorkerArtifacts =
        await readTrustedLocalServiceWorkerArtifacts(
          trustedManifest.workerIdentityPath,
        );
      const policy = createProductionReadonlyPolicy(baseUrl, {
        rollupAssetPathnames: trustedManifest.rollupAssetPathnames,
        workerIdentityPath: trustedManifest.workerIdentityPath,
        workboxPathname: trustedWorkerArtifacts.workboxPathname,
        precacheRevisionRequestTargets:
          trustedWorkerArtifacts.precacheRevisionRequestTargets,
      });
      guard = await installProductionReadonlyGuard(page, policy);
      if (context.serviceWorkers().length !== 0) {
        throw new Error(
          "Production smoke started with an unexpected service worker",
        );
      }

      primaryStage = "remote-release-manifest";
      const versionUrl = new URL(
        "/version.json?source=network",
        policy.allowedOrigin,
      ).toString();
      const versionResponse = await fetchBoundedReadonlyResource(
        versionUrl,
        policy,
        MAX_REMOTE_VERSION_BODY_BYTES,
      );
      if (
        !/no-store|no-cache/i.test(
          versionResponse.headers.get("cache-control") ?? "",
        )
      ) {
        throw new Error("Production version response failed validation");
      }
      let remoteVersionPayload: unknown;
      try {
        remoteVersionPayload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            versionResponse.body,
          ),
        );
      } catch {
        throw new Error("Production version response was not valid JSON");
      }
      const version = validateProductionReleaseManifest(
        remoteVersionPayload,
        expectedBuildId,
        expectedDeployedSha,
      );
      assertTrustedReleaseManifestMatch(version, trustedManifest);
      primaryStage = "remote-worker-artifacts";
      await verifyRemoteWorkerArtifacts(
        policy,
        trustedWorkerArtifacts.artifacts,
      );

      primaryStage = "worker-registration";
      const expectedServiceWorkerUrl = new URL(
        "/sw.js",
        policy.allowedOrigin,
      ).toString();
      const expectedServiceWorkerScope = new URL(
        "/",
        policy.allowedOrigin,
      ).toString();
      const chromiumWorkerArtifacts: readonly TrustedChromiumWorkerArtifact[] =
        Object.freeze(
          trustedWorkerArtifacts.artifacts.map((artifact) =>
            Object.freeze({
              ...artifact,
              absoluteUrl: new URL(
                artifact.pathname,
                policy.allowedOrigin,
              ).toString(),
            }),
          ),
        );
      workerAttestation = await startChromiumWorkerAttestation(
        page,
        expectedServiceWorkerScope,
        chromiumWorkerArtifacts,
      );
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
      if (serviceWorker.url() !== expectedServiceWorkerUrl) {
        throw new Error("Production service worker URL failed validation");
      }
      await expect(
        page.getByRole("heading", { name: "Privacy Policy" }),
      ).toBeVisible();

      primaryStage = "online-worker-verification";
      await expect
        .poll(
          () =>
            hasExpectedServiceWorkerState(
              page,
              expectedServiceWorkerUrl,
              expectedServiceWorkerScope,
            ),
          { timeout: 30_000 },
        )
        .toBe(true);
      await page.evaluate(async () => {
        const registration =
          await navigator.serviceWorker.getRegistration();
        if (!registration) {
          throw new Error("Active service worker registration is missing");
        }
        await registration.update();
      });
      await workerAttestation.verifyActivatedController();
      validateActiveWorkerIdentity(
        await requestActiveWorkerIdentity(page),
        expectedBuildId,
        expectedDeployedSha,
      );
      await expect.poll(() => hasExpectedPrivacyUrl(page)).toBe(true);

      primaryStage = "offline-worker-verification";
      await context.setOffline(true);
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
        .poll(() =>
          hasExpectedServiceWorkerState(
            page,
            expectedServiceWorkerUrl,
            expectedServiceWorkerScope,
          ),
        )
        .toBe(true);
      validateActiveWorkerIdentity(
        await requestActiveWorkerIdentity(page),
        expectedBuildId,
        expectedDeployedSha,
      );

      if (!(await hasExpectedPrivacyUrl(page))) {
        throw new Error("Offline privacy URL failed validation");
      }
    } catch {
      primaryFailure = true;
    } finally {
      try {
        await context.setOffline(true);
        networkIsolated = true;
      } catch {
        cleanupFailureCode = "isolate-network";
      }
      if (workerAttestation) {
        try {
          await workerAttestation.dispose();
        } catch {
          cleanupFailureCode ??= "worker-attestation";
        }
      }
      if (!networkIsolated) {
        try {
          await context.close();
          contextClosed = true;
        } catch {
          cleanupFailureCode ??= "close-context";
        }
      }
      if (guard && (networkIsolated || contextClosed)) {
        try {
          await guard.dispose();
        } catch {
          cleanupFailureCode ??= "readonly-guard";
        }
      }
      if (guard) {
        try {
          await guard.assertNoWrites();
        } catch {
          auditFailureCode ??= "request-audit";
        }
      }
      if (!contextClosed) {
        try {
          await context.close();
          contextClosed = true;
        } catch {
          cleanupFailureCode ??= "close-context";
        }
      }
      try {
        await testInfo.attach("production-readonly-attempts.json", {
          body: JSON.stringify(guard?.attempts() ?? [], null, 2),
          contentType: "application/json",
        });
      } catch {
        auditFailureCode ??= "attach-evidence";
      }
    }
    const failure = createProductionSmokeFailure({
      primaryStage: primaryFailure ? primaryStage : undefined,
      cleanupCode: cleanupFailureCode,
      auditCode: auditFailureCode,
    });
    if (failure) throw failure;
  });
});
