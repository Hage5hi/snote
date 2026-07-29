import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertTrustedWorkerArtifactBody,
  createTrustedWorkerArtifactDigest,
  createProductionReadonlyPolicy,
  fetchBoundedReadonlyResource,
  MAX_REMOTE_VERSION_BODY_BYTES,
  installProductionReadonlyGuard,
  readBoundedResponseBody,
  sanitizeProductionReadonlyAttempt,
  shouldBlockProductionRequest,
  validateRollupAssetPathnames,
} from "../../e2e/helpers/production-readonly";
import * as productionReadonlyHelpers from "../../e2e/helpers/production-readonly";

describe("production read-only smoke guard", () => {
  const versionRevision = "11111111111111111111111111111111";
  const identityRevision = "22222222222222222222222222222222";
  const indexRevision = "33333333333333333333333333333333";
  const rollupAssetPathnames = [
    "/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff",
    "/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2",
    "/assets/index-DOSI_W5I.js",
    "/assets/index-SehlPl6z.css",
    "/assets/ja-TNiK-8-v.js",
    "/assets/wardley-L42UT6IY-vH922C2V.js",
  ] as const;
  const productionPolicy = createProductionReadonlyPolicy(
    "https://note.syrin.online",
    {
      rollupAssetPathnames,
      workerIdentityPath: "/sw-identity-0123456789abcdef.js",
      workboxPathname: "/workbox-9c191d2f.js",
      precacheRevisionRequestTargets: [
        `/index.html?__WB_REVISION__=${indexRevision}`,
        `/sw-identity-0123456789abcdef.js?__WB_REVISION__=${identityRevision}`,
        `/version.json?__WB_REVISION__=${versionRevision}`,
      ],
    },
  );

  it("compares bounded worker artifacts by exact SHA-256 without echoing bytes", () => {
    const trusted = createTrustedWorkerArtifactDigest(
      "/sw.js",
      new TextEncoder().encode("trusted worker"),
    );

    expect(trusted).toEqual({
      pathname: "/sw.js",
      byteLength: 14,
      sha256:
        "896a7171b4c9c6acf1b726ff56204a6c9fef7b03ed19bafd6ee6bb6f7f536e90",
    });
    expect(() =>
      assertTrustedWorkerArtifactBody(
        new TextEncoder().encode("trusted worker"),
        trusted,
      ),
    ).not.toThrow();

    const secret = "owner-edit-view-capability-secret";
    for (const invalid of [
      new TextEncoder().encode(secret),
      new Uint8Array(),
      new Uint8Array(2_000_001),
    ]) {
      let failure: unknown;
      try {
        assertTrustedWorkerArtifactBody(invalid, trusted);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "Production worker artifact does not match trusted local build",
      );
      expect(JSON.stringify(failure)).not.toContain(secret);
    }

    for (const pathname of [
      "/sw.js?token=capability-secret",
      "/workbox-aaaaaaaa.js/extra",
      "/sw-identity-aaaaaaaaaaaaaaaa.js?source=network",
      "/api/note",
    ]) {
      expect(() =>
        createTrustedWorkerArtifactDigest(
          pathname,
          new TextEncoder().encode("trusted worker"),
        ),
      ).toThrow("Invalid trusted worker artifact");
    }
  });

  it.each([
    ["GET", "https://note.syrin.online/privacy", false],
    [
      "GET",
      "https://note.syrin.online/privacy?v=legacy-noise&foo=bar",
      false,
    ],
    ["GET", "https://note.syrin.online/privacy?foo=bar", false],
    ["HEAD", "https://note.syrin.online/version.json", false],
    [
      "GET",
      "https://note.syrin.online/version.json?source=network",
      false,
    ],
    [
      "GET",
      "https://note.syrin.online/version.json?ts=1722222222222",
      true,
    ],
    [
      "GET",
      `https://note.syrin.online/version.json?__WB_REVISION__=${versionRevision}`,
      false,
    ],
    ["GET", "https://note.syrin.online/manifest.webmanifest", false],
    ["GET", "https://note.syrin.online/favicon.ico", false],
    ["GET", "https://note.syrin.online/icon-192.png", false],
    ["GET", "https://note.syrin.online/icon-512.png", false],
    ["GET", "https://note.syrin.online/icon-maskable.png", false],
    ["GET", "https://note.syrin.online/logo.webp", false],
    ["GET", "https://note.syrin.online/theme-init.js", false],
    ["GET", "https://note.syrin.online/sw.js", false],
    [
      "GET",
      "https://note.syrin.online/sw-identity-0123456789abcdef.js",
      false,
    ],
    [
      "GET",
      `https://note.syrin.online/sw-identity-0123456789abcdef.js?__WB_REVISION__=${identityRevision}`,
      false,
    ],
    ["GET", "https://note.syrin.online/index.html", false],
    [
      "GET",
      `https://note.syrin.online/index.html?__WB_REVISION__=${indexRevision}`,
      false,
    ],
    ["GET", "https://note.syrin.online/offline.html", false],
    ["GET", "https://note.syrin.online/offline-retry.js", false],
    ["GET", "https://note.syrin.online/sw-kill.js", false],
    ["GET", "https://note.syrin.online/placeholder.svg", false],
    [
      "GET",
      "https://note.syrin.online/syrin-note-sidepanel.zip.manifest.json",
      false,
    ],
    ["GET", "https://note.syrin.online/workbox-9c191d2f.js", false],
    ["GET", "https://note.syrin.online/workbox-aaaaaaaa.js", true],
    ["GET", "https://note.syrin.online/assets/index-DOSI_W5I.js", false],
    ["GET", "https://note.syrin.online/assets/index-SehlPl6z.css", false],
    [
      "GET",
      "https://note.syrin.online/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff",
      false,
    ],
    [
      "GET",
      "https://note.syrin.online/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2",
      false,
    ],
    ["GET", "https://note.syrin.online/assets/ja-TNiK-8-v.js", false],
    [
      "GET",
      "https://note.syrin.online/assets/wardley-L42UT6IY-vH922C2V.js",
      false,
    ],
    [
      "GET",
      "https://note.syrin.online/assets/wardley-L42UT6IY-vH922C2V.js?cache=%2Fsafe-query",
      true,
    ],
    [
      "GET",
      "https://note.syrin.online/assets/absent-owner-edit-view-AbCdEf12.js",
      true,
    ],
    [
      "GET",
      "https://note.syrin.online/assets/index-DOSI_W5I.js?__WB_REVISION__=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      true,
    ],
    ["GET", "https://note.syrin.online/registersw.js", true],
    ["GET", "https://note.syrin.online/random-root.js", true],
    ["GET", "https://note.syrin.online/random-root.json", true],
    ["GET", "https://note.syrin.online/Privacy", true],
    ["GET", "https://note.syrin.online/SW.JS", true],
    ["GET", "https://note.syrin.online/ASSETS/main.js", true],
    ["GET", "https://note.syrin.online/Workbox-9c191d2f.js", true],
    ["GET", "https://note.syrin.online/assets/main.js", true],
    ["GET", "https://note.syrin.online/assets/main-abc123.js", true],
    ["GET", "https://note.syrin.online/assets/main-abc123456.js", true],
    ["GET", "https://note.syrin.online/assets/main-abc12345.exe", true],
    ["GET", "https://note.syrin.online/assets/main-abc12345.JS", true],
    ["GET", "https://note.syrin.online/assets/.main-abc12345.js", true],
    [
      "GET",
      "https://note.syrin.online/assets/nested/main-abc12345.js",
      true,
    ],
    [
      "GET",
      "https://note.syrin.online/assets/main-abc12345.js/extra",
      true,
    ],
    ["GET", "https://note.syrin.online/workbox-.js", true],
    ["GET", "https://note.syrin.online/workbox-loader.js", true],
    ["GET", "https://note.syrin.online/workbox-ABCDEF12.js", true],
    ["GET", "https://note.syrin.online/workbox-NOT_A_HASH.js", true],
    ["GET", "https://note.syrin.online/workbox-9c191d2.js", true],
    ["GET", "https://note.syrin.online/workbox-9c191d2ff.js", true],
    ["GET", "https://note.syrin.online/workbox-9c191d2f.css", true],
    ["GET", "https://note.syrin.online/workbox-9c191d2f.js.map", true],
    ["GET", "https://note.syrin.online/workbox-9c191d2f.js/extra", true],
    [
      "GET",
      "https://note.syrin.online/syrin-note-sidepanel.zip",
      true,
    ],
    ["GET", "http://localhost:8080/privacy", true],
    ["OPTIONS", "http://localhost:8080/assets/main.js", true],
    ["GET", "http://localhost:8080/@vite/client", true],
    ["GET", "http://localhost:8080/src/main.tsx", true],
    ["GET", "https://note.syrin.online/~api/analytics", true],
    ["GET", "https://note.syrin.online/~api/analytics/events", true],
    ["GET", "https://note.syrin.online/~flock.js", true],
    ["GET", "https://note.syrin.online/%7eapi%2fanalytics", true],
    ["GET", "https://note.syrin.online/%257eapi%252fanalytics", true],
    ["GET", "https://note.syrin.online/api%2fnotes", true],
    ["GET", "https://note.syrin.online/%252e%252e/~api/analytics", true],
    ["GET", "https://note.syrin.online/%252e%252e/%257eflock.js", true],
    ["GET", "https://note.syrin.online/~api%255canalytics", true],
    ["GET", "https://note.syrin.online/%255c%257eapi%255canalytics", true],
    ["GET", "https://note.syrin.online/%E0%A4%A", true],
    ["POST", "https://note.syrin.online/privacy", true],
    ["GET", "https://example.supabase.co/rest/v1/notes", true],
    ["WEBSOCKET", "wss://note.syrin.online/realtime/v1", true],
    ["GET", "https://ipapi.co/json", true],
    ["GET", "https://analytics.example.test/collect", true],
    ["GET", "https://preview.note.syrin.online/privacy", true],
    ["GET", "https://note.syrin.online.evil.test/privacy", true],
    ["GET", "https://note.syrin.online/s", true],
    ["GET", "https://note.syrin.online/s/view-capability", true],
    ["GET", "https://note.syrin.online/legacy-locator", true],
    ["GET", "https://note.syrin.online/embed/owner-capability", true],
    ["GET", "https://note.syrin.online/unrelated-public-looking-path", true],
  ])("blocks=%s %s", (method, url, expected) => {
    expect(
      shouldBlockProductionRequest(url, method, productionPolicy),
    ).toBe(expected);
  });

  it.each([
    "https://note.syrin.online/%70rivacy",
    "https://note.syrin.online/%2570rivacy",
    "https://note.syrin.online/%2e%2e/privacy",
    "https://note.syrin.online/assets/../privacy",
    "https://note.syrin.online/assets/%2e%2e/privacy",
    "https://note.syrin.online/assets%2fmain.js",
    "https://note.syrin.online/assets/%69ndex-DOSI_W5I.js?foo=bar",
    "https://note.syrin.online/assets/index-DOSI_W5I.js%2fextra?foo=bar",
    "https://note.syrin.online/workbox-9c191d2f.js%2fextra",
    "https://note.syrin.online/workbox-%2539c191d2f.js",
    "https://note.syrin.online//privacy",
    "https://note.syrin.online/./privacy",
  ])("fails closed for ambiguous encoded or traversal path %s", (url) => {
    expect(
      shouldBlockProductionRequest(url, "GET", productionPolicy),
    ).toBe(true);
  });

  it.each([
    "https://note.syrin.online/privacy?owner=capability-secret",
    "https://note.syrin.online/privacy?foo=bar&edit=capability-secret",
    "https://note.syrin.online/privacy?foo=bar&foo=bar",
    "https://note.syrin.online/privacy?foo=bar&v=legacy-noise",
    "https://note.syrin.online/version.json?token=capability-secret",
    "https://note.syrin.online/version.json?source=network&token=capability-secret",
    "https://note.syrin.online/version.json?source=network&source=network",
    "https://note.syrin.online/version.json?source=NETWORK",
    "https://note.syrin.online/version.json?source=network-v2",
    "https://note.syrin.online/version.json?ts=1722222222222&ts=1722222222222",
    "https://note.syrin.online/version.json?ts=short",
    "https://note.syrin.online/version.json?__WB_REVISION__=0123456789abcdef0123456789abcdef",
    "https://note.syrin.online/version.json?__WB_REVISION__=ABCDEF0123456789ABCDEF0123456789",
    "https://note.syrin.online/index.html?__WB_REVISION__=0123456789abcdef0123456789abcdef",
    "https://note.syrin.online/sw-identity-0123456789abcdef.js?__WB_REVISION__=0123456789abcdef0123456789abcdef",
    "https://note.syrin.online/sw-identity-0123456789abcdef.js?view=capability-secret",
    "https://note.syrin.online/sw.js?__WB_REVISION__=0123456789abcdef0123456789abcdef",
    "https://note.syrin.online/workbox-9c191d2f.js?owner=capability-secret",
    "https://note.syrin.online/assets/index-DOSI_W5I.js?edit=capability-secret",
  ])("blocks unexpected, duplicate, or capability-bearing queries: %s", (url) => {
    expect(
      shouldBlockProductionRequest(url, "GET", productionPolicy),
    ).toBe(true);
  });

  it("derives exact workbox and revision targets from one bounded local worker artifact", () => {
    type ArtifactValidator = (
      source: unknown,
      workboxFileNames: unknown,
      workerIdentityPath: unknown,
    ) => {
      workboxPathname: string;
      precacheRevisionRequestTargets: readonly string[];
    };
    const validateTrustedServiceWorkerArtifacts = (
      productionReadonlyHelpers as unknown as {
        validateTrustedServiceWorkerArtifacts?: ArtifactValidator;
      }
    ).validateTrustedServiceWorkerArtifacts;

    expect(validateTrustedServiceWorkerArtifacts).toBeTypeOf("function");
    if (!validateTrustedServiceWorkerArtifacts) return;

    const source =
      'define(["./workbox-9c191d2f"],function(s){"use strict";importScripts("/sw-identity-0123456789abcdef.js"),s.precacheAndRoute([{url:"version.json",revision:"11111111111111111111111111111111"},{url:"sw-identity-0123456789abcdef.js",revision:"22222222222222222222222222222222"},{url:"index.html",revision:"33333333333333333333333333333333"},{url:"assets/index-DOSI_W5I.js",revision:null}],{})});';

    expect(
      validateTrustedServiceWorkerArtifacts(
        source,
        ["workbox-9c191d2f.js"],
        "/sw-identity-0123456789abcdef.js",
      ),
    ).toEqual({
      workboxPathname: "/workbox-9c191d2f.js",
      precacheRevisionRequestTargets: [
        `/index.html?__WB_REVISION__=${indexRevision}`,
        `/sw-identity-0123456789abcdef.js?__WB_REVISION__=${identityRevision}`,
        `/version.json?__WB_REVISION__=${versionRevision}`,
      ],
    });

    for (const invalid of [
      {
        source,
        files: [],
        identity: "/sw-identity-0123456789abcdef.js",
      },
      {
        source,
        files: ["workbox-9c191d2f.js", "workbox-aaaaaaaa.js"],
        identity: "/sw-identity-0123456789abcdef.js",
      },
      {
        source: source.replace(
          '["./workbox-9c191d2f"]',
          '["./workbox-aaaaaaaa"]',
        ),
        files: ["workbox-9c191d2f.js"],
        identity: "/sw-identity-0123456789abcdef.js",
      },
      {
        source: source.replace(
          '{url:"version.json",revision:"11111111111111111111111111111111"},',
          "",
        ),
        files: ["workbox-9c191d2f.js"],
        identity: "/sw-identity-0123456789abcdef.js",
      },
      {
        source: source.replace(
          '{url:"sw-identity-0123456789abcdef.js",revision:"22222222222222222222222222222222"},',
          "",
        ),
        files: ["workbox-9c191d2f.js"],
        identity: "/sw-identity-0123456789abcdef.js",
      },
      {
        source: `${source}${"x".repeat(2_000_001)}`,
        files: ["workbox-9c191d2f.js"],
        identity: "/sw-identity-0123456789abcdef.js",
      },
      {
        source: source.replace(
          'revision:"33333333333333333333333333333333"',
          'revision:"owner-edit-view-capability-secret"',
        ),
        files: ["workbox-9c191d2f.js"],
        identity: "/sw-identity-0123456789abcdef.js",
      },
    ]) {
      let failure: unknown;
      try {
        validateTrustedServiceWorkerArtifacts(
          invalid.source,
          invalid.files,
          invalid.identity,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "Invalid trusted service worker artifact",
      );
      expect((failure as Error).message).not.toContain(
        "owner-edit-view-capability-secret",
      );
    }
  });

  it("rejects untrusted manifest and worker payloads without echoing received values", () => {
    type ReleaseManifest = {
      buildId: string;
      deployedSha: string;
      rollupAssetPathnames: readonly string[];
      workerIdentityPath: string;
    };
    type ManifestValidator = (
      value: unknown,
      expectedBuildId: string,
      expectedDeployedSha: string,
    ) => ReleaseManifest;
    type ManifestMatcher = (
      remote: ReleaseManifest,
      trusted: ReleaseManifest,
    ) => void;
    type WorkerIdentityValidator = (
      value: unknown,
      expectedBuildId: string,
      expectedDeployedSha: string,
    ) => void;
    const helpers = productionReadonlyHelpers as unknown as {
      validateProductionReleaseManifest?: ManifestValidator;
      assertTrustedReleaseManifestMatch?: ManifestMatcher;
      validateActiveWorkerIdentity?: WorkerIdentityValidator;
    };

    expect(helpers.validateProductionReleaseManifest).toBeTypeOf("function");
    expect(helpers.assertTrustedReleaseManifestMatch).toBeTypeOf("function");
    expect(helpers.validateActiveWorkerIdentity).toBeTypeOf("function");
    if (
      !helpers.validateProductionReleaseManifest ||
      !helpers.assertTrustedReleaseManifestMatch ||
      !helpers.validateActiveWorkerIdentity
    ) {
      return;
    }

    const expectedBuildId = "release-build";
    const expectedDeployedSha =
      "0123456789abcdef0123456789abcdef01234567";
    const trusted = helpers.validateProductionReleaseManifest(
      {
        buildId: expectedBuildId,
        deployedSha: expectedDeployedSha,
        rollupAssetPathnames,
        workerIdentityPath: "/sw-identity-0123456789abcdef.js",
      },
      expectedBuildId,
      expectedDeployedSha,
    );

    const secret = "owner-edit-view-capability-secret";
    const hostileInputs: unknown[] = [
      {
        buildId: secret,
        deployedSha: expectedDeployedSha,
        rollupAssetPathnames,
        workerIdentityPath: "/sw-identity-0123456789abcdef.js",
      },
      {
        buildId: expectedBuildId,
        deployedSha: expectedDeployedSha,
        rollupAssetPathnames,
        workerIdentityPath: secret,
      },
      {
        buildId: expectedBuildId,
        deployedSha: expectedDeployedSha,
        rollupAssetPathnames,
        workerIdentityPath: "/sw-identity-0123456789abcdef.js",
        [secret]: true,
      },
    ];

    for (const hostile of hostileInputs) {
      let failure: unknown;
      try {
        helpers.validateProductionReleaseManifest(
          hostile,
          expectedBuildId,
          expectedDeployedSha,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "Invalid production release manifest",
      );
      expect(JSON.stringify(failure)).not.toContain(secret);
      expect((failure as Error).message).not.toContain(secret);
    }

    const mismatchedRemote = {
      ...trusted,
      rollupAssetPathnames: [`/assets/${secret}-AbCdEf12.js`],
    };
    let mismatchFailure: unknown;
    try {
      helpers.assertTrustedReleaseManifestMatch(mismatchedRemote, trusted);
    } catch (error) {
      mismatchFailure = error;
    }
    expect(mismatchFailure).toBeInstanceOf(Error);
    expect((mismatchFailure as Error).message).toBe(
      "Production release manifest does not match trusted local artifact",
    );
    expect(JSON.stringify(mismatchFailure)).not.toContain(secret);

    let identityFailure: unknown;
    try {
      helpers.validateActiveWorkerIdentity(
        {
          type: "snote:sw-identity:response:v1",
          payload: {
            protocol: "snote-sw-identity-v1",
            buildId: secret,
            deployedSha: expectedDeployedSha,
          },
        },
        expectedBuildId,
        expectedDeployedSha,
      );
    } catch (error) {
      identityFailure = error;
    }
    expect(identityFailure).toBeInstanceOf(Error);
    expect((identityFailure as Error).message).toBe(
      "Invalid active service worker identity",
    );
    expect(JSON.stringify(identityFailure)).not.toContain(secret);
  });

  it("strictly validates the exact static asset manifest", () => {
    expect(validateRollupAssetPathnames(rollupAssetPathnames)).toEqual(
      rollupAssetPathnames,
    );

    for (const invalid of [
      null,
      [],
      ["/assets/z-AbCdEf12.js", "/assets/a-AbCdEf12.js"],
      ["/assets/index-AbCdEf12.js", "/assets/index-AbCdEf12.js"],
      ["/assets/nested/index-AbCdEf12.js"],
      ["/assets/owner-token.js"],
      ["/assets/index-AbCdEf12.JS"],
      ["/assets/index-AbCdEf12.exe"],
      ["/assets/index-AbCdEf12.js?owner=secret"],
      ["/assets/index-AbCdEf12.js#view=secret"],
      Array.from(
        { length: 513 },
        (_, index) => `/assets/chunk-${index.toString().padStart(4, "0")}-AbCdEf12.js`,
      ),
    ]) {
      expect(() => validateRollupAssetPathnames(invalid)).toThrow(
        "Invalid static asset manifest",
      );
    }
  });

  it("derives a fixed version transport cap above the maximum valid manifest", () => {
    const maximumAssetJsonBytes = 512 * (256 + 3);
    const fixedManifestFieldsUpperBound = 2_000;

    expect(MAX_REMOTE_VERSION_BODY_BYTES).toBe(160_000);
    expect(MAX_REMOTE_VERSION_BODY_BYTES).toBeGreaterThan(
      maximumAssetJsonBytes + fixedManifestFieldsUpperBound,
    );
  });

  it("permits localhost only for an explicit local rehearsal policy", () => {
    const localPolicy = createProductionReadonlyPolicy(
      "http://localhost:8080",
      { allowLocalhost: true },
    );

    expect(
      shouldBlockProductionRequest(
        "http://localhost:8080/src/main.tsx",
        "GET",
        localPolicy,
      ),
    ).toBe(false);
    expect(
      shouldBlockProductionRequest(
        "http://localhost:8080/privacy",
        "GET",
      ),
    ).toBe(true);
    expect(() =>
      createProductionReadonlyPolicy("http://localhost:8080"),
    ).toThrow(/localhost/i);
  });

  it.each([
    "https://user:secret@note.syrin.online/",
    "https://note.syrin.online/private",
    "https://note.syrin.online/?owner=capability-secret",
    "https://note.syrin.online/#view=capability-secret",
  ])("rejects a non-root or credential-bearing base URL: %s", (baseUrl) => {
    expect(() => createProductionReadonlyPolicy(baseUrl)).toThrow(
      /canonical origin/i,
    );
  });

  it("redacts private locators and capabilities from failure evidence", () => {
    expect(
      sanitizeProductionReadonlyAttempt(
        "https://note.syrin.online/s/view-capability-should-not-appear?token=query-secret",
        "GET",
      ),
    ).toEqual({
      method: "GET",
      origin: "canonical",
      pathname: "/s/:capability",
    });
    expect(
      sanitizeProductionReadonlyAttempt(
        "https://note.syrin.online/legacy-slug-should-not-appear",
        "GET",
      ),
    ).toEqual({
      method: "GET",
      origin: "canonical",
      pathname: "/:legacy-locator",
    });
    expect(
      sanitizeProductionReadonlyAttempt(
        "https://note.syrin.online/embed/owner-capability-should-not-appear",
        "GET",
      ),
    ).toEqual({
      method: "GET",
      origin: "canonical",
      pathname: "/:redacted-path",
    });
    expect(
      sanitizeProductionReadonlyAttempt(
        "http://localhost:8080/src/main.tsx",
        "GET",
      ),
    ).toEqual({
      method: "GET",
      origin: "local-test",
      pathname: "/:local-dev-resource",
    });
    const thirdParty = sanitizeProductionReadonlyAttempt(
      "https://192.0.2.55/legacy-locator-should-not-appear",
      "GET",
    );
    expect(thirdParty).toEqual({
      method: "GET",
      origin: "third-party",
      pathname: "/:legacy-locator",
    });
    expect(JSON.stringify(thirdParty)).not.toContain("192.0.2.55");

    const ambiguousPath = sanitizeProductionReadonlyAttempt(
      "https://note.syrin.online/%2570rivate-token-should-not-appear",
      "GET",
    );
    expect(ambiguousPath).toEqual({
      method: "GET",
      origin: "canonical",
      pathname: "/:malformed-path",
    });
    expect(JSON.stringify(ambiguousPath)).not.toContain(
      "private-token-should-not-appear",
    );

    const blockedAsset = sanitizeProductionReadonlyAttempt(
      "https://note.syrin.online/assets/nested/private-capability.js?token=query-secret",
      "GET",
    );
    expect(blockedAsset).toEqual({
      method: "GET",
      origin: "canonical",
      pathname: "/assets/:asset",
    });
    expect(JSON.stringify(blockedAsset)).not.toContain("private-capability");
    expect(JSON.stringify(blockedAsset)).not.toContain("query-secret");

    expect(shouldBlockProductionRequest("not-an-absolute-url", "GET")).toBe(
      true,
    );
    expect(
      sanitizeProductionReadonlyAttempt("not-an-absolute-url", "GET"),
    ).toEqual({
      method: "GET",
      origin: "third-party",
      pathname: "/:malformed-path",
    });
  });

  it("aborts a streaming body before buffering beyond the hard limit", async () => {
    let pulls = 0;
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(
            pulls === 1
              ? new Uint8Array([1, 2, 3, 4])
              : new Uint8Array([5]),
          );
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await expect(readBoundedResponseBody(response, 4)).rejects.toThrow(
      "Production response body exceeded safety limit",
    );
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
  });

  it("rejects an oversized declared body before reading the stream", async () => {
    let pulled = false;
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulled = true;
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { "content-length": "5" } },
    );

    await expect(readBoundedResponseBody(response, 4)).rejects.toThrow(
      "Production response body exceeded safety limit",
    );
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true);
  });

  it("returns an exact bounded body without reading past completion", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
      { headers: { "content-length": "4" } },
    );

    await expect(readBoundedResponseBody(response, 4)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("rejects a blocked URL or invalid body cap before issuing fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        fetchBoundedReadonlyResource(
          "https://note.syrin.online/functions/v1/note-sync",
          productionPolicy,
          4,
        ),
      ).rejects.toThrow("Production bounded request failed validation");
      await expect(
        fetchBoundedReadonlyResource(
          "https://note.syrin.online/version.json?source=network",
          productionPolicy,
          0,
        ),
      ).rejects.toThrow("Production bounded request failed validation");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits for an in-flight blocked route before final audit", async () => {
    let routeHandler!: (route: {
      request(): { url(): string; method(): string };
      abort(reason: string): Promise<void>;
      continue(): Promise<void>;
    }) => Promise<void>;
    let activeRoute: Promise<void> | undefined;
    let releaseAbort!: () => void;
    const abortGate = new Promise<void>((resolveAbort) => {
      releaseAbort = resolveAbort;
    });
    let signalAbortStarted!: () => void;
    const abortStarted = new Promise<void>((resolveStarted) => {
      signalAbortStarted = resolveStarted;
    });
    const continueRequest = vi.fn(async () => undefined);
    const context = {
      route: vi.fn(
        async (
          _pattern: string,
          handler: typeof routeHandler,
        ) => {
          routeHandler = handler;
        },
      ),
      routeWebSocket: vi.fn(async () => undefined),
      unrouteAll: vi.fn(
        async (options: { behavior: string }) => {
          expect(options).toEqual({ behavior: "wait" });
          await activeRoute;
        },
      ),
    };
    const page = {
      context: () => context,
    };

    const guard = await installProductionReadonlyGuard(
      page as never,
      productionPolicy,
    );
    activeRoute = routeHandler({
      request: () => ({
        url: () =>
          "https://note.syrin.online/functions/v1/note-sync",
        method: () => "POST-owner-edit-view-capability-secret",
      }),
      abort: async (reason) => {
        expect(reason).toBe("blockedbyclient");
        signalAbortStarted();
        await abortGate;
      },
      continue: continueRequest,
    });
    await abortStarted;

    let disposed = false;
    const dispose = guard.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    releaseAbort();
    await activeRoute;
    await dispose;

    expect(continueRequest).not.toHaveBeenCalled();
    expect(context.unrouteAll).toHaveBeenCalledTimes(1);
    expect(guard.attempts()).toEqual([
      {
        method: "OTHER",
        origin: "canonical",
        pathname: "/:blocked-api",
      },
    ]);
    expect(JSON.stringify(guard.attempts())).not.toContain(
      "owner-edit-view-capability-secret",
    );
    await expect(guard.assertNoWrites()).rejects.toThrow();
  });

  it("disables captured browser artifacts for the production privacy smoke", () => {
    const spec = readFileSync(
      resolve(process.cwd(), "e2e/pwa-update-production-readonly.spec.ts"),
      "utf8",
    );

    expect(spec).toContain('trace: "off"');
    expect(spec).toContain('screenshot: "off"');
    expect(spec).toContain('video: "off"');
    expect(spec).toContain("createProductionReadonlyPolicy");
    expect(spec).toContain("installProductionReadonlyGuard(page, policy)");
  });

  it("keeps bounded resource probes canonical and refuses redirects", () => {
    const spec = readFileSync(
      resolve(process.cwd(), "e2e/pwa-update-production-readonly.spec.ts"),
      "utf8",
    );

    expect(spec).not.toContain("shouldBlockProductionRequest");
    expect(spec).toMatch(
      /const versionUrl = new URL\(\s*"\/version\.json\?source=network",\s*policy\.allowedOrigin,\s*\)\.toString\(\);/,
    );
    expect(spec).toContain("fetchBoundedReadonlyResource");
    expect(spec).toContain("MAX_REMOTE_VERSION_BODY_BYTES");
    expect(spec).not.toContain("const trustedDigest");
    expect(spec).toContain("trusted.byteLength");
    expect(spec).toContain("assertTrustedWorkerArtifactBody(body, trusted)");
    expect(spec).not.toContain("page.request.get");
    expect(spec).not.toContain("response.body()");
    expect(spec).not.toContain("versionResponse.json()");
    expect(spec).toContain('new TextDecoder("utf-8", { fatal: true })');
    expect(spec).toContain('"/version.json?source=network"');
    expect(spec).toContain("validateProductionReleaseManifest");
    expect(spec).toContain("assertTrustedReleaseManifestMatch");
    expect(spec).toContain("trustedManifest.rollupAssetPathnames");
    expect(spec).toContain("dist/version.json");
  });

  it("uses the deployed service worker for registration and offline privacy", () => {
    const spec = readFileSync(
      resolve(process.cwd(), "e2e/pwa-update-production-readonly.spec.ts"),
      "utf8",
    );
    const helper = readFileSync(
      resolve(process.cwd(), "e2e/helpers/production-readonly.ts"),
      "utf8",
    );
    const chromiumAttestationHelper = readFileSync(
      resolve(
        process.cwd(),
        "e2e/helpers/chromium-worker-attestation.ts",
      ),
      "utf8",
    );

    expect(spec).toContain('serviceWorkers: "allow"');
    expect(spec).not.toContain("pwa-update-mock");
    expect(spec).not.toContain("installPwaUpdateMock");
    expect(spec).not.toContain("getHardReloadCount");
    expect(spec).not.toMatch(/getByRole\("button",\s*\{\s*name:\s*\/\^Update/);
    expect(spec).toContain('context.waitForEvent("serviceworker"');
    expect(spec).toContain("Promise.all");
    expect(spec).not.toContain("page.waitForFunction");
    expect(spec).not.toContain("navigator.serviceWorker.ready");
    expect(spec).toContain(
      'navigator.serviceWorker.getRegistration("/")',
    );
    expect(spec).toContain("MessageChannel");
    expect(spec).toContain("snote:sw-identity:request:v1");
    expect(helper).toContain("snote:sw-identity:response:v1");
    expect(spec).toContain("validateTrustedServiceWorkerArtifacts");
    expect(spec).toContain("validateActiveWorkerIdentity");
    expect(spec).toContain("createTrustedWorkerArtifactDigest");
    expect(spec).toContain("assertTrustedWorkerArtifactBody");
    expect(spec).toContain("startChromiumWorkerAttestation");
    expect(spec).toContain(
      "await workerAttestation.verifyActivatedController()",
    );
    expect(spec.indexOf("startChromiumWorkerAttestation(")).toBeLessThan(
      spec.indexOf('page.goto("/privacy?v=legacy-noise&foo=bar"'),
    );
    expect(chromiumAttestationHelper).toContain('context.on("response"');
    expect(chromiumAttestationHelper).toContain('"ServiceWorker.enable"');
    expect(chromiumAttestationHelper).toContain(
      '"ServiceWorker.workerVersionUpdated"',
    );
    expect(chromiumAttestationHelper).toContain('"Target.attachToTarget"');
    expect(chromiumAttestationHelper).toContain("flatten: false");
    expect(chromiumAttestationHelper).toContain(
      '"Debugger.getScriptSource"',
    );
    expect(chromiumAttestationHelper).toContain(
      '"Target.sendMessageToTarget"',
    );
    expect(chromiumAttestationHelper).toContain(
      '"Target.receivedMessageFromTarget"',
    );
    expect(spec).toContain('"remote-worker-artifacts"');
    expect(spec).toContain("createProductionSmokeFailure");
    expect(spec).toContain(
      "primaryStage: primaryFailure ? primaryStage : undefined",
    );
    expect(spec).not.toContain("new AggregateError");
    expect(spec).toContain("hasExpectedPrivacyUrl");
    expect(spec).not.toContain("expect(context.serviceWorkers()).toEqual");
    expect(spec).not.toContain("unrelatedValue");
    expect(spec).not.toContain(
      "if (primaryFailure) throw primaryFailure",
    );
    expect(spec).toMatch(
      /new URL\(\s*"\/sw\.js",\s*policy\.allowedOrigin,\s*\)\.toString\(\)/,
    );
    expect(spec).toMatch(
      /new URL\(\s*"\/",\s*policy\.allowedOrigin,\s*\)\.toString\(\)/,
    );
    expect(spec).toContain('active.state === "activated"');
    expect(spec).toContain("navigator.serviceWorker.controller");
    expect(spec).toContain("await context.setOffline(true)");
    expect(spec).toContain("offlineResponse.fromServiceWorker()");
    expect(spec).not.toContain("context.setOffline(false)");
    expect(spec).toContain("/privacy?v=legacy-noise&foo=bar");
    expect(spec).toContain('searchParams.has("v")');
    expect(spec).toContain('searchParams.get("foo")');
    expect(spec).toContain("test.describe.configure({ timeout: 120_000 })");
    expect(spec).toContain("let networkIsolated = false");
    expect(spec).toContain("let contextClosed = false");
    expect(spec).toMatch(
      /context\.setOffline\(true\)[\s\S]*networkIsolated = true[\s\S]*if \(!networkIsolated\)[\s\S]*context\.close\(\)[\s\S]*if \(guard && \(networkIsolated \|\| contextClosed\)\)[\s\S]*guard\.dispose\(\)[\s\S]*assertNoWrites\(\)[\s\S]*production-readonly-attempts\.json/,
    );
    expect(spec).toContain(
      "guard = await installProductionReadonlyGuard(page, policy)",
    );
    expect(spec).toContain("await guard.assertNoWrites()");
    expect(spec).toContain("await guard.dispose()");
  });

  it("surfaces only constant-safe failure codes in the Playwright-visible error", async () => {
    const noOp = () => {};
    const playwrightTest = Object.assign(noOp, {
      use: noOp,
      describe: noOp,
    });
    vi.doMock("@playwright/test", () => ({
      expect: noOp,
      test: playwrightTest,
    }));

    try {
      const smokeModule = (await import(
        "../../e2e/pwa-update-production-readonly.spec"
      )) as unknown as {
        createProductionSmokeFailure(options: {
          primaryStage?: unknown;
          cleanupCode?: unknown;
          auditCode?: unknown;
        }): Error | null;
      };
      const secret = "owner-edit-view-capability-secret";
      const failure = smokeModule.createProductionSmokeFailure({
        primaryStage: "remote-worker-artifacts",
        cleanupCode: "isolate-network",
        auditCode: "request-audit",
      });

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).toBe(
        "Production PWA smoke failed [primary:remote-worker-artifacts, cleanup:isolate-network, audit:request-audit]",
      );
      expect(failure?.stack).toContain(
        "primary:remote-worker-artifacts",
      );

      const hostileFailure = smokeModule.createProductionSmokeFailure({
        primaryStage: secret,
        cleanupCode: secret,
        auditCode: secret,
      });
      expect(hostileFailure?.message).toBe(
        "Production PWA smoke failed [primary:unknown, cleanup:unknown, audit:unknown]",
      );
      expect(hostileFailure?.stack).not.toContain(secret);
      expect(
        smokeModule.createProductionSmokeFailure({}),
      ).toBeNull();
    } finally {
      vi.doUnmock("@playwright/test");
      vi.resetModules();
    }
  });

  it("uses the no-store request policy without a dynamic version query", () => {
    const updater = readFileSync(
      resolve(process.cwd(), "src/lib/pwa-update.ts"),
      "utf8",
    );

    expect(updater).toContain(
      'fetch("/version.json?source=network", {',
    );
    expect(updater).toContain('cache: "no-store"');
    expect(updater).not.toContain("/version.json?ts=");
  });

  it("does not start a local Vite server during a post-deploy smoke", () => {
    const config = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(config).toContain('process.env.POST_DEPLOY_SMOKE === "1"');
    expect(config).toContain("webServer: isPostDeploySmoke ? undefined");
    expect(config).toContain("https://note.syrin.online");
  });
});
