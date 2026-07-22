import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type CutoverProbe = {
  cutoverAt: string;
  edgeCutoff: string;
  clientCutoff: string;
  shareViewUrl: string;
  distDirectory: string;
  fetcher?: typeof fetch;
};

function canonicalTimestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString()) {
    throw new Error(`${name} must be a canonical UTC ISO timestamp`);
  }
  return parsed;
}

export function expectedLegacyShareCutoff(cutoverAt: string): string {
  return new Date(canonicalTimestamp(cutoverAt, "CAPABILITY_CUTOVER_AT") + THIRTY_DAYS_MS)
    .toISOString();
}

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

export async function verifyCapabilityCutover(input: CutoverProbe): Promise<void> {
  const expected = expectedLegacyShareCutoff(input.cutoverAt);
  canonicalTimestamp(input.edgeCutoff, "LEGACY_SHARE_CUTOFF");
  canonicalTimestamp(input.clientCutoff, "VITE_LEGACY_SHARE_CUTOFF");
  if (input.edgeCutoff !== expected || input.clientCutoff !== expected) {
    throw new Error("cutoff mismatch: both deployments must equal cutover + 30 days");
  }

  const endpoint = new URL(input.shareViewUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("CAPABILITY_SHARE_VIEW_URL must be a credential-free HTTPS endpoint");
  }

  const builtFiles = filesBelow(input.distDirectory)
    .filter((path) => /\.(?:html|js|mjs)$/i.test(path));
  if (!builtFiles.some((path) => readFileSync(path, "utf8").includes(expected))) {
    throw new Error("built client does not contain the verified legacy cutoff");
  }

  const response = await (input.fetcher ?? fetch)(endpoint, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => null) as { legacyShareCutoff?: unknown } | null;
  if (
    !response.ok
    || !response.headers.get("cache-control")?.includes("no-store")
    || body?.legacyShareCutoff !== expected
  ) {
    throw new Error("deployed Edge cutoff does not match the built client");
  }
}

async function main() {
  await verifyCapabilityCutover({
    cutoverAt: process.env.CAPABILITY_CUTOVER_AT ?? "",
    edgeCutoff: process.env.LEGACY_SHARE_CUTOFF ?? "",
    clientCutoff: process.env.VITE_LEGACY_SHARE_CUTOFF ?? "",
    shareViewUrl: process.env.CAPABILITY_SHARE_VIEW_URL ?? "",
    distDirectory: resolve(process.env.CUTOVER_CLIENT_DIST ?? "dist"),
  });
  console.log("Capability cutover deadline verified against build and deployed Edge.");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
