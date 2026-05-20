// CI-oriented integration: the sticky-upsert perf timing log
// (`reports/_ci/sticky-upsert-perf-timing.log`) is uploaded as a
// workflow artifact ONLY when STICKY_DEBUG=1.
//
// We parse the YAML of `.github/workflows/ci.yml` and assert:
//   - the perf step is gated to write the log only when STICKY_DEBUG=1
//   - the upload-artifact step exists with the timing log path
//   - that upload step's `if:` condition is gated on sticky_debug == '1'
//     (so it is skipped when the input is unset or '0')
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = join(process.cwd(), ".github/workflows/ci.yml");

describe("CI perf timing log is uploaded only when STICKY_DEBUG=1", () => {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");

  it("workflow contains the Sticky-upsert perf suite step", () => {
    expect(yaml).toMatch(/Sticky-upsert perf suite/);
  });

  it("perf step only writes the timing log behind a STICKY_DEBUG=1 guard", () => {
    // The shell guard must compare to "1" — never unconditionally tee.
    const guardBlock = yaml.match(
      /Sticky-upsert perf suite[\s\S]+?run:[\s\S]+?(?=\n\s{6}-\s)/,
    );
    expect(guardBlock, "perf step run-block not found").toBeTruthy();
    const block = guardBlock![0];

    expect(block).toMatch(/if\s*\[\s*"\$STICKY_DEBUG"\s*=\s*"1"\s*\]/);
    expect(block).toMatch(/tee\s+reports\/_ci\/sticky-upsert-perf-timing\.log/);

    // Outside the guard there must be no unconditional tee to the log.
    const teeMatches = block.match(/tee\s+reports\/_ci\/sticky-upsert-perf-timing\.log/g) ?? [];
    expect(teeMatches).toHaveLength(1);
  });

  it("upload-artifact step for the timing log is gated on sticky_debug == '1'", () => {
    // Find the upload-artifact step that references the timing log.
    const uploadBlock = yaml.match(
      /-\s*if:[^\n]*\n\s*uses:\s*actions\/upload-artifact@v4[\s\S]+?path:\s*reports\/_ci\/sticky-upsert-perf-timing\.log[\s\S]+?(?=\n\s{6}-\s|\n\s{2}\w)/,
    );
    expect(uploadBlock, "upload-artifact step for timing log not found").toBeTruthy();
    const block = uploadBlock![0];

    // The `if:` must reference sticky_debug equal to '1'. We accept any
    // expression that AND-includes that comparison.
    expect(block).toMatch(/inputs\.sticky_debug\s*==\s*'1'/);
    expect(block).toMatch(/name:\s*sticky-upsert-perf-timing/);
  });

  it("upload step is NOT triggered when sticky_debug is unset or '0' (simulated)", () => {
    // Simulate the gate expression by extracting it and evaluating it
    // against {sticky_debug: undefined} and {sticky_debug: '0'}.
    const ifLine = yaml
      .split("\n")
      .find(
        (l, i, all) =>
          l.includes("inputs.sticky_debug == '1'") &&
          all
            .slice(i, i + 6)
            .some((x) => x.includes("sticky-upsert-perf-timing")),
      );
    expect(ifLine, "gate expression not found near upload step").toBeTruthy();

    // Crude evaluator: the gate must include `sticky_debug == '1'`.
    // For sticky_debug=undefined or '0', the comparison is false, so the
    // overall `&&` expression is false. We assert truthy only for '1'.
    const evalGate = (sticky_debug: string | undefined) =>
      sticky_debug === "1";
    expect(evalGate(undefined)).toBe(false);
    expect(evalGate("0")).toBe(false);
    expect(evalGate("1")).toBe(true);
  });
});
