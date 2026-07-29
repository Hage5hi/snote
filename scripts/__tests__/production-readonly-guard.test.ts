import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProductionReadonlyPolicy,
  sanitizeProductionReadonlyAttempt,
  shouldBlockProductionRequest,
  validateRollupAssetPathnames,
} from "../../e2e/helpers/production-readonly";

describe("production read-only smoke guard", () => {
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
    },
  );

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
      "https://note.syrin.online/version.json?ts=1722222222222",
      false,
    ],
    [
      "GET",
      "https://note.syrin.online/version.json?__WB_REVISION__=0123456789abcdef0123456789abcdef",
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
      "https://note.syrin.online/sw-identity-0123456789abcdef.js?__WB_REVISION__=0123456789abcdef0123456789abcdef",
      false,
    ],
    ["GET", "https://note.syrin.online/index.html", false],
    [
      "GET",
      "https://note.syrin.online/index.html?__WB_REVISION__=0123456789abcdef0123456789abcdef",
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
    "https://note.syrin.online/version.json?ts=1722222222222&ts=1722222222222",
    "https://note.syrin.online/version.json?ts=short",
    "https://note.syrin.online/version.json?__WB_REVISION__=ABCDEF0123456789ABCDEF0123456789",
    "https://note.syrin.online/sw-identity-0123456789abcdef.js?view=capability-secret",
    "https://note.syrin.online/sw.js?__WB_REVISION__=0123456789abcdef0123456789abcdef",
    "https://note.syrin.online/workbox-9c191d2f.js?owner=capability-secret",
    "https://note.syrin.online/assets/index-DOSI_W5I.js?edit=capability-secret",
  ])("blocks unexpected, duplicate, or capability-bearing queries: %s", (url) => {
    expect(
      shouldBlockProductionRequest(url, "GET", productionPolicy),
    ).toBe(true);
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

  it("disables captured browser artifacts for the production privacy smoke", () => {
    const spec = readFileSync(
      resolve(process.cwd(), "e2e/pwa-update-production-readonly.spec.ts"),
      "utf8",
    );

    expect(spec).toContain('trace: "off"');
    expect(spec).toContain('screenshot: "off"');
    expect(spec).toContain('video: "off"');
    expect(spec).toContain("createProductionReadonlyPolicy");
    expect(spec).toContain("installProductionReadonlyGuard(context, policy)");
  });

  it("keeps the API request probe canonical and refuses redirects", () => {
    const spec = readFileSync(
      resolve(process.cwd(), "e2e/pwa-update-production-readonly.spec.ts"),
      "utf8",
    );

    expect(spec).toContain("shouldBlockProductionRequest");
    expect(spec).toMatch(
      /const versionUrl = new URL\(\s*"\/version\.json",\s*policy\.allowedOrigin,\s*\)\.toString\(\);/,
    );
    expect(spec).toContain(
      'expect(shouldBlockProductionRequest(versionUrl, "GET", policy)).toBe(false)',
    );
    expect(spec).toContain("maxRedirects: 0");
    expect(spec).toContain("expect(versionResponse.url()).toBe(versionUrl)");
    expect(spec).toContain(
      'expect(versionResponse.headers()).not.toHaveProperty("location")',
    );
    expect(spec).toContain("validateRollupAssetPathnames");
    expect(spec).toContain("version.rollupAssetPathnames");
    expect(spec).toContain("dist/version.json");
  });

  it("uses the deployed service worker for registration and offline privacy", () => {
    const spec = readFileSync(
      resolve(process.cwd(), "e2e/pwa-update-production-readonly.spec.ts"),
      "utf8",
    );

    expect(spec).toContain('serviceWorkers: "allow"');
    expect(spec).not.toContain("pwa-update-mock");
    expect(spec).not.toContain("installPwaUpdateMock");
    expect(spec).not.toContain("getHardReloadCount");
    expect(spec).not.toMatch(/getByRole\("button",\s*\{\s*name:\s*\/\^Update/);
    expect(spec).toContain('context.waitForEvent("serviceworker"');
    expect(spec).toContain("Promise.all");
    expect(spec).toContain("navigator.serviceWorker.ready");
    expect(spec).toContain("MessageChannel");
    expect(spec).toContain("snote:sw-identity:request:v1");
    expect(spec).toContain("snote:sw-identity:response:v1");
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
    expect(spec).toMatch(
      /finally\s*\{[\s\S]*await context\.setOffline\(false\)[\s\S]*\}/,
    );
    expect(spec).toContain("/privacy?v=legacy-noise&foo=bar");
    expect(spec).toContain('searchParams.has("v")');
    expect(spec).toContain('searchParams.get("foo")');
    expect(spec).toContain("test.describe.configure({ timeout: 120_000 })");
    expect(spec).toMatch(
      /finally\s*\{[\s\S]*context\.close\(\)[\s\S]*production-readonly-attempts\.json[\s\S]*assertNoWrites/,
    );
  });

  it("documents the honest split between production and local PWA coverage", () => {
    const readme = readFileSync(
      resolve(process.cwd(), "e2e/README.md"),
      "utf8",
    );

    expect(readme).toMatch(
      /production[\s\S]*real service worker[\s\S]*registration[\s\S]*activation[\s\S]*offline `\/privacy`/i,
    );
    expect(readme).toMatch(/local mocked specs[\s\S]*UI transitions/i);
    expect(readme).toMatch(
      /separate local two-build real harness[\s\S]*(?:planned|next|not yet implemented)/i,
    );
    expect(readme).toMatch(
      /does not yet provide real A-to-B[\s\S]*stalled-worker rollback proof/i,
    );
    expect(readme).toMatch(
      /mocked specs[\s\S]*cannot make that claim/i,
    );
    expect(readme).not.toMatch(/harness is responsible/i);
    expect(readme).toMatch(/repository_dispatch[\s\S]*workflow_dispatch/i);
    expect(readme).toMatch(
      /no automatic Lovable\s+publish emitter/i,
    );
  });

  it("does not start a local Vite server during a post-deploy smoke", () => {
    const config = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(config).toContain('process.env.POST_DEPLOY_SMOKE === "1"');
    expect(config).toContain("webServer: isPostDeploySmoke ? undefined");
    expect(config).toContain("https://note.syrin.online");
  });
});
