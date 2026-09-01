// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker.js";

const TOKEN = "superSecretToken42";
const ENCODED_TOKEN = "super%53ecretToken42";
const SHARE_PREFIXES = ["s", "%73", "%2573", "S"] as const;
const TOKEN_PATHS = [
  TOKEN,
  ENCODED_TOKEN,
  "short",
  "future.token.format",
  "asset-looking.js",
  "nested/asset.css",
] as const;
const PRIVATE_SLUG = "private-edit-slug";
const ROBOTS = "noindex, nofollow, noarchive, nosnippet";
const ENCODED_SEPARATOR_PATHS = [
  `s%2F${TOKEN}`,
  `%73%2F${TOKEN}`,
  `%2Fs/${TOKEN}`,
  `s%252F${TOKEN}`,
  `%2573%252F${TOKEN}`,
  `s%5C${TOKEN}`,
  `s%255C${TOKEN}`,
  `s%2F${TOKEN}.js`,
  `%2Fs/${TOKEN}/asset.css`,
  `x/%252e%252e/s%252F${TOKEN}.js`,
  `s/${TOKEN}/%252e%252e/%252e%252e/asset.js`,
  `s/${TOKEN}/%252e%252e/%252e%252e/public-note`,
  `x/%252e%252e/s/${TOKEN}/%252e%252e/%252e%252e/asset.js`,
] as const;
const META_CRAWLERS = [
  "meta-externalagent/1.1",
  "meta-externalfetcher/1.1",
] as const;

function installWorkerDoubles() {
  const cacheMatch = vi.fn(async () => undefined);
  const cachePut = vi.fn(async () => undefined);
  const metadataFetch = vi.fn(async () =>
    new Response(
      JSON.stringify({
        found: true,
        slug: PRIVATE_SLUG,
        snippet: "private note preview",
        isEncrypted: false,
      }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  const waitUntil = vi.fn();

  vi.stubGlobal("caches", {
    default: { match: cacheMatch, put: cachePut },
  });
  vi.stubGlobal("fetch", metadataFetch);

  return { cacheMatch, cachePut, metadataFetch, waitUntil };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function expectContainedShare({
  hostname,
  path,
  userAgent,
  clientIp,
}: {
  hostname: string;
  path: string;
  userAgent: string;
  clientIp: string;
}) {
  const doubles = installWorkerDoubles();
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line) =>
    logs.push(String(line)),
  );

  const response = await worker.fetch(
    new Request(`https://${hostname}/${path}`, {
      headers: {
        "cf-connecting-ip": clientIp,
        "user-agent": userAgent,
      },
    }),
    {
      ORIGIN_HOST: "snote.lovable.app",
      SITE_URL: "https://note.syrin.online",
      SUPABASE_PROJECT: "example",
      SUPABASE_ANON_KEY: "anon",
      NOTE_META_SECRET: "secret",
    },
    { waitUntil: doubles.waitUntil },
  );

  const body = await response.text();
  const observable = [
    body,
    response.headers.get("location") ?? "",
    response.headers.get("etag") ?? "",
    ...logs,
  ].join("\n");

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("x-robots-tag")).toBe(ROBOTS);
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(body).toContain(`<meta name="robots" content="${ROBOTS}"`);
  expect(body).toContain('<meta name="referrer" content="no-referrer"');
  expect(observable).not.toContain(TOKEN);
  expect(observable).not.toContain(ENCODED_TOKEN);
  expect(observable).not.toContain(PRIVATE_SLUG);
  expect(observable).not.toContain(clientIp);
  expect(observable).not.toContain(`/s/${TOKEN}`);
  expect(doubles.metadataFetch).not.toHaveBeenCalled();
  expect(doubles.cacheMatch).not.toHaveBeenCalled();
  expect(doubles.cachePut).not.toHaveBeenCalled();
  expect(doubles.waitUntil).not.toHaveBeenCalled();
}

describe("share crawler containment", () => {
  it.each([
    "/sw.js",
    "/registerSW.js",
    "/manifest.webmanifest",
    "/favicon.ico",
    "/version.json",
    "/workbox-9c191d2f.js",
    "/icon-192.png",
    "/sitemap.xml",
    "/sw-kill.js",
  ])("passes runtime artifact %s to origin without public caching", async (path) => {
    const doubles = installWorkerDoubles();

    const response = await worker.fetch(
      new Request(`https://note.syrin.online${path}`, {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
      { ORIGIN_HOST: "snote.lovable.app", SITE_URL: "https://note.syrin.online" },
      { waitUntil: doubles.waitUntil },
    );

    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    const originRequest = doubles.metadataFetch.mock.calls[0]?.[0] as Request;
    expect(new URL(originRequest.url).pathname).toBe(path);
  });

  it.each([
    {
      requestPath: "/index.html?__WB_REVISION__=root",
      originPath: "/",
      originSearch: "?__WB_REVISION__=root",
    },
    {
      requestPath: "/offline.html?__WB_REVISION__=offline",
      originPath: "/offline",
      originSearch: "?__WB_REVISION__=offline",
    },
  ])(
    "uses the reviewed non-redirecting Pages path for $requestPath",
    async ({ requestPath, originPath, originSearch }) => {
      const doubles = installWorkerDoubles();
      doubles.metadataFetch.mockImplementation(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith(".html")) {
          return new Response(null, {
            status: 308,
            headers: { location: url.pathname.replace(/\.html$/, "") || "/" },
          });
        }
        return new Response("reviewed html", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      });

      const response = await worker.fetch(
        new Request(`https://note.syrin.online${requestPath}`, {
          headers: { "user-agent": "Mozilla/5.0" },
        }),
        {
          ORIGIN_HOST: "snote-g4-origin.pages.dev",
          SITE_URL: "https://note.syrin.online",
        },
        { waitUntil: doubles.waitUntil },
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("reviewed html");
      expect(response.headers.get("cache-control")).toBe(
        "no-cache, no-store, must-revalidate",
      );
      expect(response.headers.get("cdn-cache-control")).toBe("no-store");
      expect(doubles.metadataFetch).toHaveBeenCalledOnce();
      const originRequest = doubles.metadataFetch.mock.calls[0]?.[0] as Request;
      const originUrl = new URL(originRequest.url);
      expect(originUrl.pathname).toBe(originPath);
      expect(originUrl.search).toBe(originSearch);
      expect(originRequest.redirect).toBe("manual");
    },
  );

  it.each([
    {
      requestPath: "/index.html?__WB_REVISION__=abc123&token=secret",
      originPath: "/",
    },
    {
      requestPath: "/offline.html?__WB_REVISION__=abc123&token=secret",
      originPath: "/offline",
    },
  ])(
    "forwards only a conservative Workbox revision from mixed HTML alias params for $requestPath",
    async ({ requestPath, originPath }) => {
      const doubles = installWorkerDoubles();
      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((line) =>
        logs.push(String(line)),
      );
      doubles.metadataFetch.mockImplementation(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith(".html")) {
          return new Response(null, {
            status: 308,
            headers: { location: url.pathname.replace(/\.html$/, "") || "/" },
          });
        }
        return new Response("reviewed html", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      });

      const response = await worker.fetch(
        new Request(`https://note.syrin.online${requestPath}`, {
          headers: { "user-agent": "Mozilla/5.0" },
        }),
        {
          ORIGIN_HOST: "snote-g4-origin.pages.dev",
          SITE_URL: "https://note.syrin.online",
        },
        { waitUntil: doubles.waitUntil },
      );

      expect(response.status).toBe(200);
      expect(doubles.metadataFetch).toHaveBeenCalledOnce();
      const originRequest = doubles.metadataFetch.mock.calls[0]?.[0] as Request;
      const originUrl = new URL(originRequest.url);
      expect(originUrl.pathname).toBe(originPath);
      expect(originUrl.search).toBe("?__WB_REVISION__=abc123");
      expect(originRequest.url).not.toContain("token");
      expect(originRequest.url).not.toContain("secret");
      expect(logs.join("\n")).not.toContain("token");
      expect(logs.join("\n")).not.toContain("secret");
      expect(logs.join("\n")).not.toContain("abc123");
      expect(logs.join("\n")).not.toContain("__WB_REVISION__");
    },
  );

  it.each([
    { label: "empty", requestPath: "/index.html?__WB_REVISION__=" },
    {
      label: "too long",
      requestPath: `/index.html?__WB_REVISION__=${"a".repeat(129)}`,
    },
    { label: "path traversal", requestPath: "/index.html?__WB_REVISION__=../" },
    {
      label: "token-like",
      requestPath: "/index.html?__WB_REVISION__=tok=secret",
    },
  ])(
    "drops an invalid Workbox revision ($label) before the origin fetch",
    async ({ requestPath }) => {
      const doubles = installWorkerDoubles();
      doubles.metadataFetch.mockImplementation(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith(".html")) {
          return new Response(null, {
            status: 308,
            headers: { location: url.pathname.replace(/\.html$/, "") || "/" },
          });
        }
        return new Response("reviewed html", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      });

      const response = await worker.fetch(
        new Request(`https://note.syrin.online${requestPath}`, {
          headers: { "user-agent": "Mozilla/5.0" },
        }),
        {
          ORIGIN_HOST: "snote-g4-origin.pages.dev",
          SITE_URL: "https://note.syrin.online",
        },
        { waitUntil: doubles.waitUntil },
      );

      expect(response.status).toBe(200);
      const originRequest = doubles.metadataFetch.mock.calls[0]?.[0] as Request;
      const originUrl = new URL(originRequest.url);
      expect(originUrl.pathname).toBe("/");
      expect(originUrl.search).toBe("");
      expect(originRequest.url).not.toContain("token");
      expect(originRequest.url).not.toContain("secret");
      expect(originRequest.url).not.toContain("../");
      expect(originRequest.url).not.toContain("a".repeat(129));
    },
  );

  it.each([
    {
      requestPath: `/s/${TOKEN}?__WB_REVISION__=root&token=secret`,
      originPath: "/s",
    },
    {
      requestPath: `/${PRIVATE_SLUG}?__WB_REVISION__=root&token=secret`,
      originPath: "/",
    },
    {
      requestPath: "/unlock?__WB_REVISION__=root&token=secret",
      originPath: "/",
    },
  ])(
    "does not forward Workbox revision or locator query for $requestPath",
    async ({ requestPath, originPath }) => {
      const doubles = installWorkerDoubles();

      const response = await worker.fetch(
        new Request(`https://note.syrin.online${requestPath}`, {
          headers: { "user-agent": "Mozilla/5.0" },
        }),
        {
          ORIGIN_HOST: "snote.lovable.app",
          SITE_URL: "https://note.syrin.online",
        },
        { waitUntil: doubles.waitUntil },
      );

      expect(response.status).toBe(200);
      const originRequest = doubles.metadataFetch.mock.calls[0]?.[0] as Request;
      const originUrl = new URL(originRequest.url);
      expect(originUrl.pathname).toBe(originPath);
      expect(originUrl.search).toBe("");
      expect(originRequest.url).not.toContain(TOKEN);
      expect(originRequest.url).not.toContain(PRIVATE_SLUG);
      expect(originRequest.url).not.toContain("__WB_REVISION__");
      expect(originRequest.url).not.toContain("token");
      expect(originRequest.url).not.toContain("secret");
    },
  );

  it("contains a raw markdown note locator without forwarding it to origin", async () => {
    const doubles = installWorkerDoubles();

    const response = await worker.fetch(
      new Request("https://note.syrin.online/private-note.md", {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
      { ORIGIN_HOST: "snote.lovable.app", SITE_URL: "https://note.syrin.online" },
      { waitUntil: doubles.waitUntil },
    );

    expect(response.headers.get("x-robots-tag")).toBe(ROBOTS);
    const originRequest = doubles.metadataFetch.mock.calls[0]?.[0] as Request;
    expect(new URL(originRequest.url).pathname).toBe("/");
  });

  it("keeps the public privacy page outside private-route containment", async () => {
    const doubles = installWorkerDoubles();

    const response = await worker.fetch(
      new Request("https://note.syrin.online/privacy", {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
      {
        ORIGIN_HOST: "snote.lovable.app",
        SITE_URL: "https://note.syrin.online",
      },
      { waitUntil: doubles.waitUntil },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("cdn-cache-control")).toBeNull();
    expect(doubles.metadataFetch).toHaveBeenCalledOnce();
    const originRequest = doubles.metadataFetch.mock.calls[0]?.[0] as Request;
    expect(new URL(originRequest.url).pathname).toBe("/privacy");
  });

  it.each([
    { path: `/s/${TOKEN}`, originPath: "/s" },
    { path: `/${PRIVATE_SLUG}`, originPath: "/" },
  ])(
    "does not echo a browser credential in a www redirect for %s",
    async ({ path, originPath }) => {
      const doubles = installWorkerDoubles();

      const response = await worker.fetch(
        new Request(`https://www.syrin.online${path}`, {
          headers: { "user-agent": "Mozilla/5.0" },
        }),
        {
          ORIGIN_HOST: "snote.lovable.app",
          SITE_URL: "https://note.syrin.online",
        },
        { waitUntil: doubles.waitUntil },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("cdn-cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toBe(ROBOTS);
      expect(doubles.metadataFetch).toHaveBeenCalledOnce();
      const originRequest = doubles.metadataFetch.mock.calls[0]?.[0] as Request;
      const originUrl = new URL(originRequest.url);
      expect(originUrl.hostname).toBe("snote.lovable.app");
      expect(originUrl.pathname).toBe(originPath);
      expect(originUrl.search).toBe("");
    },
  );

  it("never serves cached plaintext metadata for a private note route", async () => {
    const doubles = installWorkerDoubles();
    doubles.cacheMatch.mockResolvedValueOnce(
      new Response("old private note preview from before encryption"),
    );

    const response = await worker.fetch(
      new Request("https://note.syrin.online/public-note", {
        headers: {
          "cf-connecting-ip": "203.0.113.250",
          "user-agent": "Slackbot-LinkExpanding 1.0",
        },
      }),
      {
        ORIGIN_HOST: "snote.lovable.app",
        SITE_URL: "https://note.syrin.online",
        SUPABASE_PROJECT: "example",
        SUPABASE_ANON_KEY: "anon",
        NOTE_META_SECRET: "secret",
      },
      { waitUntil: doubles.waitUntil },
    );

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe(ROBOTS);
    expect(body).not.toContain("public-note");
    expect(body).not.toContain(PRIVATE_SLUG);
    expect(body).not.toContain("old private note preview");
    expect(doubles.metadataFetch).not.toHaveBeenCalled();
    expect(doubles.cacheMatch).not.toHaveBeenCalled();
    expect(doubles.cachePut).not.toHaveBeenCalled();
    expect(doubles.waitUntil).not.toHaveBeenCalled();
  });

  let caseIndex = 0;
  for (const hostname of [
    "note.syrin.online",
    "syrin.online",
    "www.syrin.online",
  ]) {
    for (const suffix of ["", "/"]) {
      for (const prefix of SHARE_PREFIXES) {
        for (const tokenPath of TOKEN_PATHS) {
          const clientIp = `203.0.113.${++caseIndex}`;
          it(`returns one generic, uncacheable response for ${hostname}/${prefix}/${tokenPath}${suffix}`, async () => {
            await expectContainedShare({
              hostname,
              path: `${prefix}/${tokenPath}${suffix}`,
              userAgent: "Slackbot-LinkExpanding 1.0",
              clientIp,
            });
          });
        }
      }
    }
  }

  for (const hostname of ["note.syrin.online", "syrin.online", "www.syrin.online"]) {
    for (const path of ENCODED_SEPARATOR_PATHS) {
      const clientIp = `198.51.100.${++caseIndex}`;
      it(`contains encoded separators for ${hostname}/${path}`, async () => {
        await expectContainedShare({
          hostname,
          path,
          userAgent: "Slackbot-LinkExpanding 1.0",
          clientIp,
        });
      });
    }

    for (const userAgent of META_CRAWLERS) {
      const clientIp = `192.0.2.${++caseIndex}`;
      it(`contains ${userAgent} on ${hostname}`, async () => {
        await expectContainedShare({
          hostname,
          path: `s/${TOKEN}`,
          userAgent,
          clientIp,
        });
      });
    }
  }

  it("disables raw Cloudflare invocation URL logs in committed deployment config", () => {
    const config = readFileSync(
      resolve(process.cwd(), "cloudflare-worker/wrangler.toml"),
      "utf8",
    );
    const readme = readFileSync(
      resolve(process.cwd(), "cloudflare-worker/README.md"),
      "utf8",
    );
    const rollout = readFileSync(
      resolve(process.cwd(), "docs/security/immediate-containment-rollout.md"),
      "utf8",
    );

    expect(config).toMatch(
      /\[observability\.logs\][\s\S]*invocation_logs\s*=\s*false/,
    );
    expect(readme).toContain("invocation_logs = false");
    expect(rollout).toMatch(/Workers\s+Logs/);
    expect(rollout).toMatch(/Tail\s+Workers/);
    expect(rollout).toContain("Logpush");
    expect(rollout).toContain("every query-string variant");
    expect(rollout).toContain("historical `?slug=...` and");
    expect(rollout).toContain("`?token=...` forms");
  });
});
