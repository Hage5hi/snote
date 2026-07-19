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
const ROBOTS = "noindex,nofollow,noarchive,nosnippet";
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
      SITE_URL: "https://syrin.online",
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
  expect(response.headers.get("cache-control")).toBe("no-store");
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
  });
});
