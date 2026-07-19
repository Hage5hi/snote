import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker.js";

const TOKEN = "superSecretToken42";
const PRIVATE_SLUG = "private-edit-slug";
const ROBOTS = "noindex,nofollow,noarchive,nosnippet";

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

describe("share crawler containment", () => {
  for (const hostname of ["syrin.online", "www.syrin.online"]) {
    for (const suffix of ["", "/"]) {
      it(`returns one generic, uncacheable response for ${hostname}/s/:token${suffix}`, async () => {
      const doubles = installWorkerDoubles();
      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((line) => logs.push(String(line)));

      const response = await worker.fetch(
        new Request(`https://${hostname}/s/${TOKEN}${suffix}`, {
          headers: {
            "cf-connecting-ip": "203.0.113.42",
            "user-agent": "Slackbot-LinkExpanding 1.0",
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
      expect(body).toContain(`<meta name="robots" content="${ROBOTS}"`);
      expect(observable).not.toContain(TOKEN);
      expect(observable).not.toContain(PRIVATE_SLUG);
      expect(observable).not.toContain("203.0.113.42");
      expect(observable).not.toContain(`/s/${TOKEN}`);
      expect(doubles.metadataFetch).not.toHaveBeenCalled();
      expect(doubles.cacheMatch).not.toHaveBeenCalled();
      expect(doubles.cachePut).not.toHaveBeenCalled();
      expect(doubles.waitUntil).not.toHaveBeenCalled();
      });
    }
  }
});
