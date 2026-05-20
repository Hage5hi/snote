// Smoke test for `scripts/ci-sticky-newest-wins-overlap-replay.ts`.
//
// We don't shell out — the script exposes `runReplay(argv)` so we can
// drive it directly, capture stdout, and assert it prints the
// scanStats + selected id for each scenario, AND writes a JSON
// artifact summary to a configurable path.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReplay } from "../ci-sticky-newest-wins-overlap-replay";

describe("ci-sticky-newest-wins-overlap-replay CLI", () => {
  let logs: string[];
  let spy: ReturnType<typeof vi.spyOn>;
  let dir: string;
  const ORIG_ENV = process.env.STICKY_REPLAY_ARTIFACT;
  const ORIG_GHA = process.env.GITHUB_ACTIONS;

  beforeEach(() => {
    logs = [];
    spy = vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.join(" "));
    });
    dir = mkdtempSync(join(tmpdir(), "sticky-replay-"));
    delete process.env.STICKY_REPLAY_ARTIFACT;
    delete process.env.GITHUB_ACTIONS;
  });
  afterEach(() => {
    spy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    if (ORIG_ENV !== undefined) process.env.STICKY_REPLAY_ARTIFACT = ORIG_ENV;
    else delete process.env.STICKY_REPLAY_ARTIFACT;
    if (ORIG_GHA !== undefined) process.env.GITHUB_ACTIONS = ORIG_GHA;
    else delete process.env.GITHUB_ACTIONS;
  });

  it("default scenario (overlap-dup-page) selects id=900 and prints scanStats", async () => {
    const out = join(dir, "default.json");
    const code = await runReplay(["--out", out]);
    expect(code).toBe(0);
    const joined = logs.join("\n");
    expect(joined).toMatch(/scenario=overlap-dup-page/);
    expect(joined).toMatch(/"selectedId": 900/);
    expect(joined).toMatch(/"scanStats":/);
    expect(joined).toMatch(/"pagesWalked": 2/);
  });

  it("--scenario newest-on-first-page reports cleanedIds [100,200,300]", async () => {
    const code = await runReplay([
      "--scenario",
      "newest-on-first-page",
      "--no-artifact",
    ]);
    expect(code).toBe(0);
    const joined = logs.join("\n");
    expect(joined).toMatch(/"selectedId": 900/);
    expect(joined).toMatch(/"cleanedIds": \[\s*300,\s*200,\s*100\s*\]/);
    expect(joined).toMatch(/"pagesWalked": 3/);
  });

  it("--help prints usage and returns 0", async () => {
    const code = await runReplay(["--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/ci-sticky-newest-wins-overlap-replay/);
  });

  it("writes a JSON artifact to --out path with the full summary payload", async () => {
    const out = join(dir, "out.json");
    const code = await runReplay(["--scenario", "overlap-dup-page", "--out", out]);
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(parsed.schema).toBe("sticky-replay/v1");
    expect(parsed.scenario).toBe("overlap-dup-page");
    expect(parsed.selectedId).toBe(900);
    expect(parsed.scanStats.pagesWalked).toBe(2);
    expect(logs.join("\n")).toContain(`wrote artifact=${out}`);
  });

  it("$STICKY_REPLAY_ARTIFACT is honored when --out is not passed", async () => {
    const out = join(dir, "from-env.json");
    process.env.STICKY_REPLAY_ARTIFACT = out;
    const code = await runReplay(["--scenario", "rerun"]);
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(parsed.scenario).toBe("rerun");
  });

  it("--no-artifact suppresses the file write", async () => {
    const out = join(dir, "should-not-exist.json");
    process.env.STICKY_REPLAY_ARTIFACT = out;
    const code = await runReplay(["--no-artifact"]);
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it("emits a ::notice:: GitHub Actions annotation when GITHUB_ACTIONS=true", async () => {
    process.env.GITHUB_ACTIONS = "true";
    const out = join(dir, "annot.json");
    const code = await runReplay(["--out", out]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain(
      `::notice file=${out}::sticky-replay scenario=overlap-dup-page`,
    );
  });
});
