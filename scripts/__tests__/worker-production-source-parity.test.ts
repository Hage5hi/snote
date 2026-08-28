/** @vitest-environment node */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_WORKER_SHA256 =
  "ee1cec6d4dac7803c2ba4a1eeecc910c6473d236eca5f733156ae7c49d4c9b3b";
const SECTION_HEADER = /^\[[A-Za-z0-9_.-]+]\s*$/m;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

function tomlSection(config: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\[${escapedName}\\]\\s*$`, "m").exec(config);
  if (!header) return "";

  const body = config.slice(header.index + header[0].length);
  const nextSection = body.search(SECTION_HEADER);
  return nextSection === -1 ? body : body.slice(0, nextSection);
}

function tomlPreamble(config: string): string {
  const firstSection = config.search(SECTION_HEADER);
  return firstSection === -1 ? config : config.slice(0, firstSection);
}

describe("Worker production source parity", () => {
  it("pins the reviewed production Worker source", () => {
    const worker = source("cloudflare-worker/worker.js");
    const sha256 = createHash("sha256").update(worker, "utf8").digest("hex");

    expect(sha256).toBe(EXPECTED_WORKER_SHA256);
  });

  it("pins the production Wrangler deployment contract", () => {
    const config = source("cloudflare-worker/wrangler.toml");
    const uncommentedConfig = config
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    const topLevel = tomlPreamble(uncommentedConfig);
    const routesBlock = topLevel.match(
      /^routes\s*=\s*\[([\s\S]*?)]\s*$/m,
    )?.[1] ?? "";
    const routePatterns = [
      ...routesBlock.matchAll(/\bpattern\s*=\s*"([^"]+)"/g),
    ].map(([, pattern]) => pattern);
    const vars = tomlSection(uncommentedConfig, "vars");
    const observability = tomlSection(uncommentedConfig, "observability");
    const logs = tomlSection(uncommentedConfig, "observability.logs");
    const traces = tomlSection(uncommentedConfig, "observability.traces");
    const secretNames = [
      ...uncommentedConfig.matchAll(
        /\b(?:SUPABASE_(?:ANON_KEY|PUBLISHABLE_KEY|SERVICE_ROLE_KEY)|NOTE_META_SECRET|CAPABILITY_HMAC_SECRET|CLOUDFLARE_API_TOKEN|ADMIN_PASSPHRASE)\b/g,
      ),
    ].map(([name]) => name);
    expect(secretNames).toEqual([]);

    expect.soft(topLevel, "Worker name").toMatch(
      /^name\s*=\s*"syrin-prerender"\s*$/m,
    );
    expect.soft(topLevel, "Worker entrypoint").toMatch(
      /^main\s*=\s*"worker\.js"\s*$/m,
    );
    expect.soft(topLevel, "workers.dev must stay disabled").toMatch(
      /^workers_dev\s*=\s*false\s*$/m,
    );
    expect.soft(topLevel, "preview URLs must stay disabled").toMatch(
      /^preview_urls\s*=\s*false\s*$/m,
    );
    expect.soft(vars, "dedicated Pages origin").toMatch(
      /^ORIGIN_HOST\s*=\s*"snote-g4-origin\.pages\.dev"\s*$/m,
    );
    expect.soft(vars, "canonical site URL").toMatch(
      /^SITE_URL\s*=\s*"https:\/\/note\.syrin\.online"\s*$/m,
    );

    expect.soft(routePatterns, "production route count").toHaveLength(3);
    expect.soft(
      routePatterns.filter((route) => route === "note.syrin.online/*"),
      "note route",
    ).toHaveLength(1);
    expect.soft(
      routePatterns.filter((route) => route === "syrin.online/*"),
      "apex route",
    ).toHaveLength(1);
    expect.soft(
      routePatterns.filter((route) => route === "www.syrin.online/*"),
      "www route",
    ).toHaveLength(1);

    expect.soft(observability, "observability must stay disabled").toMatch(
      /^enabled\s*=\s*false\s*$/m,
    );
    expect.soft(logs, "observability logs must stay disabled").toMatch(
      /^enabled\s*=\s*false\s*$/m,
    );
    expect.soft(logs, "invocation logs must stay disabled").toMatch(
      /^invocation_logs\s*=\s*false\s*$/m,
    );
    expect.soft(traces, "observability traces must stay disabled").toMatch(
      /^enabled\s*=\s*false\s*$/m,
    );

  });
});
