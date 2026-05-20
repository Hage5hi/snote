// Smoke test for `scripts/ci-sticky-newest-wins-overlap-replay.ts`.
//
// We don't shell out — the script exposes `runReplay(argv)` so we can
// drive it directly, capture stdout, and assert it prints the
// scanStats + selected id for each scenario. Keeps the replay CLI
// honest as the upsert behavior evolves.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { runReplay } from "../ci-sticky-newest-wins-overlap-replay";

describe("ci-sticky-newest-wins-overlap-replay CLI", () => {
  let logs: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs = [];
    spy = vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.join(" "));
    });
  });
  afterEach(() => spy.mockRestore());

  it("default scenario (overlap-dup-page) selects id=900 and prints scanStats", async () => {
    const code = await runReplay([]);
    expect(code).toBe(0);
    const joined = logs.join("\n");
    expect(joined).toMatch(/scenario=overlap-dup-page/);
    expect(joined).toMatch(/"selectedId": 900/);
    expect(joined).toMatch(/"scanStats":/);
    expect(joined).toMatch(/"pagesWalked": 2/);
  });

  it("--scenario newest-on-first-page reports cleanedIds [100,200,300]", async () => {
    const code = await runReplay(["--scenario", "newest-on-first-page"]);
    expect(code).toBe(0);
    const joined = logs.join("\n");
    expect(joined).toMatch(/"selectedId": 900/);
    expect(joined).toMatch(/"cleanedIds": \[\s*100,\s*200,\s*300\s*\]/);
    expect(joined).toMatch(/"pagesWalked": 3/);
  });

  it("--help prints usage and returns 0", async () => {
    const code = await runReplay(["--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/ci-sticky-newest-wins-overlap-replay/);
  });
});
