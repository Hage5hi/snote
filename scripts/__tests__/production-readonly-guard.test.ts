import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProductionReadonlyPolicy,
  sanitizeProductionReadonlyAttempt,
  shouldBlockProductionRequest,
} from "../../e2e/helpers/production-readonly";

describe("production read-only smoke guard", () => {
  it.each([
    ["GET", "https://note.syrin.online/privacy", false],
    ["HEAD", "https://note.syrin.online/version.json", false],
    ["GET", "https://note.syrin.online/assets/main-abc123.js", false],
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
    expect(shouldBlockProductionRequest(url, method)).toBe(expected);
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

  it("does not start a local Vite server during a post-deploy smoke", () => {
    const config = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(config).toContain('process.env.POST_DEPLOY_SMOKE === "1"');
    expect(config).toContain("webServer: isPostDeploySmoke ? undefined");
    expect(config).toContain("https://note.syrin.online");
  });
});
