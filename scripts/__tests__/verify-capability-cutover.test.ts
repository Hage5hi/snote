// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expectedLegacyShareCutoff,
  verifyCapabilityCutover,
} from "../verify-capability-cutover";

const CUTOVER = "2026-07-24T12:00:00.000Z";
const CUTOFF = "2026-08-23T12:00:00.000Z";
const temporaryDirectories: string[] = [];

function builtClient(cutoff = CUTOFF) {
  const directory = mkdtempSync(join(tmpdir(), "snote-cutover-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "index.js"), `const legacyCutoff=${JSON.stringify(cutoff)};`);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("capability cutover deployment guard", () => {
  it("requires the exact cutover plus 30-day timestamp", () => {
    expect(expectedLegacyShareCutoff(CUTOVER)).toBe(CUTOFF);
    expect(() => expectedLegacyShareCutoff("2026-07-24")).toThrow("canonical");
  });

  it("verifies both env values, the built client, and deployed Edge", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(
      { legacyShareCutoff: CUTOFF },
      { headers: { "cache-control": "no-store" } },
    ));

    await expect(verifyCapabilityCutover({
      cutoverAt: CUTOVER,
      edgeCutoff: CUTOFF,
      clientCutoff: CUTOFF,
      shareViewUrl: "https://project.supabase.co/functions/v1/share-view",
      distDirectory: builtClient(),
      fetcher,
    })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://project.supabase.co/functions/v1/share-view"),
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("aborts before migration on any build or Edge mismatch", async () => {
    await expect(verifyCapabilityCutover({
      cutoverAt: CUTOVER,
      edgeCutoff: "2026-08-24T12:00:00.000Z",
      clientCutoff: CUTOFF,
      shareViewUrl: "https://project.supabase.co/functions/v1/share-view",
      distDirectory: builtClient(),
      fetcher: vi.fn(),
    })).rejects.toThrow("cutoff mismatch");

    await expect(verifyCapabilityCutover({
      cutoverAt: CUTOVER,
      edgeCutoff: CUTOFF,
      clientCutoff: CUTOFF,
      shareViewUrl: "https://project.supabase.co/functions/v1/share-view",
      distDirectory: builtClient("wrong"),
      fetcher: vi.fn(),
    })).rejects.toThrow("built client");
  });
});
