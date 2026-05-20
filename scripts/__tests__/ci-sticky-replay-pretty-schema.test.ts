// Ensures `--pretty` combined with `--json` still produces a file
// that parses as valid JSON AND passes the strict schema validators.
// This is the contract documented in docs/ci-sticky-pr-comment.md:
// pretty changes only whitespace, never the schema shape.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReplay as runOverlapReplay } from "../ci-sticky-newest-wins-overlap-replay";
import { runFuzzReplay } from "../ci-sticky-fuzz-failure-replay";
import {
  validateOverlapReplayResult,
  validateFuzzReplayResult,
} from "../_helpers/sticky-replay-schemas";

describe("--pretty + --json files remain schema-valid", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sticky-pretty-schema-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("overlap replay --pretty --json output passes validateOverlapReplayResult", async () => {
    const f = join(dir, "overlap.json");
    expect(await runOverlapReplay(["--out", f, "--pretty"])).toBe(0);
    const parsed = JSON.parse(readFileSync(f, "utf8"));
    expect(validateOverlapReplayResult(parsed)).toEqual([]);
  });

  it("overlap replay compact --json output also passes the validator", async () => {
    const f = join(dir, "overlap-compact.json");
    expect(await runOverlapReplay(["--out", f])).toBe(0);
    const parsed = JSON.parse(readFileSync(f, "utf8"));
    expect(validateOverlapReplayResult(parsed)).toEqual([]);
  });

  it("fuzz replay --pretty --json output passes validateFuzzReplayResult", async () => {
    const marker = "<!-- sticky:pretty-schema -->";
    const artifact = join(dir, "art.json");
    writeFileSync(
      artifact,
      JSON.stringify({
        schema: "sticky-fuzz-failure/v1",
        seed: 9,
        iteration: 2,
        inputs: { markerLiteral: marker, body: `${marker}\nx`, cleanedIds: [3, 4] },
      }),
      "utf8",
    );
    const out = join(dir, "fuzz-pretty.json");
    expect(await runFuzzReplay([artifact, "--json", out, "--pretty"])).toBe(0);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(validateFuzzReplayResult(parsed)).toEqual([]);
  });
});
