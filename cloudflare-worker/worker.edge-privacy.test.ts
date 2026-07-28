// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker.js";

const CSP =
  "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; " +
  "frame-ancestors 'self' chrome-extension://*; script-src 'self' https://challenges.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://flagcdn.com " +
  "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev; font-src 'self' data:; " +
  "connect-src 'self' https://onfzjmfjldsbthchssfr.supabase.co " +
  "wss://onfzjmfjldsbthchssfr.supabase.co https://challenges.cloudflare.com; " +
  "frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; " +
  "manifest-src 'self'; upgrade-insecure-requests;";
const PRIVATE_ROBOTS = "noindex, nofollow, noarchive, nosnippet";
const PERMISSIONS_POLICY =
  "camera=(), geolocation=(), microphone=(), payment=()";
const ENV = {
  ORIGIN_HOST: "snote.lovable.app",
  SITE_URL: "https://note.syrin.online",
};

function installOriginDouble() {
  const originFetch = vi.fn(async () =>
    new Response("<!doctype html><html><body>app shell</body></html>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
        etag: '"origin-etag"',
        "last-modified": "Tue, 28 Jul 2026 00:00:00 GMT",
        nel: '{"report_to":"origin"}',
        "report-to": '{"group":"origin"}',
        "reporting-endpoints": 'origin="https://telemetry.invalid/report"',
        "server-timing": "analytics;dur=1",
      },
    }),
  );
  const cacheMatch = vi.fn(async () => undefined);
  const cachePut = vi.fn(async () => undefined);
  const waitUntil = vi.fn();

  vi.stubGlobal("fetch", originFetch);
  vi.stubGlobal("caches", {
    default: { match: cacheMatch, put: cachePut },
  });

  return { originFetch, cacheMatch, cachePut, waitUntil };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("edge privacy containment", () => {
  it.each([
    { path: "/~flock.js", statuses: [410] },
    { path: "/~api/analytics", statuses: [204, 410] },
    { path: "/~api/analytics/events", statuses: [204, 410] },
    { path: "/x/%252e%252e/~flock.js", statuses: [410] },
    {
      path: "/x/%252e%252e/~api%252fanalytics/events",
      statuses: [204, 410],
    },
  ])("denies $path before the Lovable origin", async ({ path, statuses }) => {
    const doubles = installOriginDouble();

    const response = await worker.fetch(
      new Request(`https://note.syrin.online${path}`),
      ENV,
      { waitUntil: doubles.waitUntil },
    );

    expect(statuses).toContain(response.status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(doubles.originFetch).not.toHaveBeenCalled();
  });

  it.each([
    "/synthetic-private-note",
    "/s/synthetic-share-capability",
    "/unlock",
    "/embed/synthetic-private-note",
    "/embed/synthetic-private-note.js",
    "/api/error",
    "/compat/synthetic-private-note",
  ])("makes private HTML uncacheable and non-indexable for %s", async (path) => {
    const doubles = installOriginDouble();

    const response = await worker.fetch(
      new Request(`https://note.syrin.online${path}`, {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
      ENV,
      { waitUntil: doubles.waitUntil },
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("x-robots-tag")).toBe(PRIVATE_ROBOTS);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
    expect(response.headers.get("nel")).toBeNull();
    expect(response.headers.get("report-to")).toBeNull();
    expect(response.headers.get("reporting-endpoints")).toBeNull();
    expect(response.headers.get("server-timing")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe(CSP);
    expect(response.headers.get("permissions-policy")).toBe(PERMISSIONS_POLICY);
    expect(response.headers.get("x-frame-options")).toBeNull();
  });

  it.each(["/", "/privacy"])(
    "keeps the public document %s outside private indexing policy",
    async (path) => {
      const doubles = installOriginDouble();

      const response = await worker.fetch(
        new Request(`https://note.syrin.online${path}`, {
          headers: { "user-agent": "Mozilla/5.0" },
        }),
        ENV,
        { waitUntil: doubles.waitUntil },
      );

      expect(response.headers.get("x-robots-tag")).toBeNull();
      expect(response.headers.get("content-security-policy")).toBe(CSP);
      expect(response.headers.get("permissions-policy")).toBe(
        PERMISSIONS_POLICY,
      );
      expect(response.headers.get("x-frame-options")).toBeNull();
    },
  );

  it.each(["/", "/privacy"])(
    "does not expose a public document query to the origin for %s",
    async (path) => {
      const doubles = installOriginDouble();
      const syntheticQuery = "private-capability-must-not-reach-origin";

      await worker.fetch(
        new Request(
          `https://note.syrin.online${path}?token=${syntheticQuery}`,
          { headers: { "user-agent": "Mozilla/5.0" } },
        ),
        ENV,
        { waitUntil: doubles.waitUntil },
      );

      const originRequest = doubles.originFetch.mock.calls[0]?.[0] as Request;
      const originUrl = new URL(originRequest.url);
      expect(originUrl.pathname).toBe(path);
      expect(originUrl.search).toBe("");
      expect(originRequest.url).not.toContain(syntheticQuery);
    },
  );

  it("publicly caches only fingerprinted assets", async () => {
    const doubles = installOriginDouble();

    const fingerprinted = await worker.fetch(
      new Request("https://note.syrin.online/assets/index-AbCdEf12.js"),
      ENV,
      { waitUntil: doubles.waitUntil },
    );
    const unfingerprinted = await worker.fetch(
      new Request("https://note.syrin.online/assets/runtime.js"),
      ENV,
      { waitUntil: doubles.waitUntil },
    );

    expect(fingerprinted.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(unfingerprinted.headers.get("cache-control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    expect(unfingerprinted.headers.get("cdn-cache-control")).toBe("no-store");
  });

  it.each([
    "/assets/index-AbCdEf12.js",
    "/assets/runtime.js",
    "/theme-init.js",
  ])("strips untrusted queries before fetching the allowed asset %s", async (path) => {
    const doubles = installOriginDouble();
    const syntheticQuery = "private-capability-must-not-reach-origin";

    await worker.fetch(
      new Request(
        `https://note.syrin.online${path}?token=${syntheticQuery}`,
      ),
      ENV,
      { waitUntil: doubles.waitUntil },
    );

    const originRequest = doubles.originFetch.mock.calls[0]?.[0] as Request;
    const originUrl = new URL(originRequest.url);
    expect(originUrl.pathname).toBe(path);
    expect(originUrl.search).toBe("");
    expect(originRequest.url).not.toContain(syntheticQuery);
  });

  it("treats an unlisted root artifact as a private route", async () => {
    const doubles = installOriginDouble();
    const syntheticQuery = "private-capability-must-not-reach-origin";

    const response = await worker.fetch(
      new Request(
        `https://note.syrin.online/private-capability.js?token=${syntheticQuery}`,
      ),
      ENV,
      { waitUntil: doubles.waitUntil },
    );

    const originRequest = doubles.originFetch.mock.calls[0]?.[0] as Request;
    const originUrl = new URL(originRequest.url);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe(PRIVATE_ROBOTS);
    expect(originUrl.pathname).toBe("/");
    expect(originUrl.search).toBe("");
    expect(originRequest.url).not.toContain(syntheticQuery);
  });

  it("redirects a public alias route to the canonical origin", async () => {
    const doubles = installOriginDouble();

    const response = await worker.fetch(
      new Request("https://syrin.online/privacy", {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
      ENV,
      { waitUntil: doubles.waitUntil },
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://note.syrin.online/privacy",
    );
    expect(doubles.originFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["syrin.online", "privacy", "/privacy"],
    ["syrin.online", "theme-init.js", "/theme-init.js"],
    [
      "syrin.online",
      "assets/index-AbCdEf12.js",
      "/assets/index-AbCdEf12.js",
    ],
    ["www.syrin.online", "privacy", "/privacy"],
    ["www.syrin.online", "theme-init.js", "/theme-init.js"],
    [
      "www.syrin.online",
      "assets/index-AbCdEf12.js",
      "/assets/index-AbCdEf12.js",
    ],
  ])(
    "does not reflect a traversed private segment through %s for %s",
    async (host, suffix, safePath) => {
      const doubles = installOriginDouble();
      const privateSegment = "private-capability-must-not-reach-redirect";

      const response = await worker.fetch(
        new Request(
          `https://${host}/${privateSegment}/%252e%252e/${suffix}?token=query-secret`,
        ),
        ENV,
        { waitUntil: doubles.waitUntil },
      );

      const location = response.headers.get("location") ?? "";
      expect(response.status).toBe(301);
      expect(location).toBe(`https://note.syrin.online${safePath}`);
      expect(location).not.toContain(privateSegment);
      expect(location).not.toContain("query-secret");
      expect(doubles.originFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["privacy", "/privacy"],
    ["theme-init.js", "/theme-init.js"],
    ["assets/index-AbCdEf12.js", "/assets/index-AbCdEf12.js"],
  ])(
    "does not expose a traversed private segment to the origin for %s",
    async (suffix, safePath) => {
      const doubles = installOriginDouble();
      const privateSegment = "private-capability-must-not-reach-origin";

      await worker.fetch(
        new Request(
          `https://note.syrin.online/${privateSegment}/%252e%252e/${suffix}?token=query-secret`,
        ),
        ENV,
        { waitUntil: doubles.waitUntil },
      );

      const originRequest = doubles.originFetch.mock.calls[0]?.[0] as Request;
      const originUrl = new URL(originRequest.url);
      expect(originUrl.pathname).toBe(safePath);
      expect(originUrl.search).toBe("");
      expect(originRequest.url).not.toContain(privateSegment);
      expect(originRequest.url).not.toContain("query-secret");
    },
  );

  it("does not echo a private alias path or raw client address", async () => {
    const doubles = installOriginDouble();
    const logs: string[] = [];
    const syntheticPath = "/embed/synthetic-private-capability";
    const syntheticIp = "192.0.2.44";
    vi.spyOn(console, "log").mockImplementation((line) =>
      logs.push(String(line)),
    );

    const response = await worker.fetch(
      new Request(`https://www.syrin.online${syntheticPath}`, {
        headers: {
          "cf-connecting-ip": syntheticIp,
          "user-agent": "Mozilla/5.0",
        },
      }),
      ENV,
      { waitUntil: doubles.waitUntil },
    );

    const originRequest = doubles.originFetch.mock.calls[0]?.[0] as Request;
    const observable = [
      response.headers.get("location") ?? "",
      new URL(originRequest.url).pathname,
      ...logs,
    ].join("\n");

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new URL(originRequest.url).pathname).toBe("/");
    expect(observable).not.toContain(syntheticPath);
    expect(observable).not.toContain("synthetic-private-capability");
    expect(observable).not.toContain(syntheticIp);
  });
});
