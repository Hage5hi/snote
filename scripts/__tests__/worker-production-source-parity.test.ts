/** @vitest-environment node */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_WORKER_SHA256 = "ee1cec6d4dac7803c2ba4a1eeecc910c6473d236eca5f733156ae7c49d4c9b3b";
const EXPECTED_WRANGLER_TOML = `name = "syrin-prerender"
main = "worker.js"
compatibility_date = "2024-11-01"
workers_dev = false
preview_urls = false

routes = [
  { pattern = "note.syrin.online/*", zone_name = "syrin.online" },
  { pattern = "syrin.online/*", zone_name = "syrin.online" },
  { pattern = "www.syrin.online/*", zone_name = "syrin.online" },
]

[vars]
ORIGIN_HOST = "snote-g4-origin.pages.dev"
SITE_URL = "https://note.syrin.online"

[observability]
enabled = false

[observability.logs]
enabled = false
invocation_logs = false

[observability.traces]
enabled = false
`;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
}

describe("Worker production source parity", () => {
  it("pins the reviewed production Worker source", () => {
    const worker = source("cloudflare-worker/worker.js");
    const sha256 = createHash("sha256").update(worker, "utf8").digest("hex");

    expect(sha256).toBe(EXPECTED_WORKER_SHA256);
  });

  it("pins the production Wrangler deployment contract", () => {
    const config = source("cloudflare-worker/wrangler.toml");
    const secretNames = [
      ...config.matchAll(
        /\b(?:SUPABASE_(?:ANON_KEY|PUBLISHABLE_KEY|SERVICE_ROLE_KEY)|NOTE_META_SECRET|CAPABILITY_HMAC_SECRET|CLOUDFLARE_API_TOKEN|ADMIN_PASSPHRASE)\b/g,
      ),
    ].map(([name]) => name);
    expect(secretNames).toEqual([]);
    expect(config).toBe(EXPECTED_WRANGLER_TOML);
  });
});
