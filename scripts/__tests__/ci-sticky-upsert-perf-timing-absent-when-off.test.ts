// CI workflow contract: the sticky-upsert perf timing log
// (`reports/_ci/sticky-upsert-perf-timing.log`) is NEITHER created NOR
// uploaded when STICKY_DEBUG is unset or "0".
//
// Complements `ci-sticky-upsert-perf-timing-upload.test.ts`, which
// checks the positive case (debug=1 → log is teed + uploaded). This
// file pins the NEGATIVE case end-to-end:
//   - the perf step only tees behind `[ "$STICKY_DEBUG" = "1" ]`
//   - a defensive purge step removes any stale log when sticky_debug != '1'
//   - the upload-artifact step's `if:` excludes unset / "0" sticky_debug
//
// We don't actually run CI here; we parse the YAML and assert the
// gating expressions are exactly the ones we want.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
const LOG_PATH = "reports/_ci/sticky-upsert-perf-timing.log";

describe("CI: perf timing log is absent when STICKY_DEBUG is unset or '0'", () => {
  it("the perf step tees the log only inside the STICKY_DEBUG=1 branch", () => {
    const teeMatches = WORKFLOW.match(new RegExp(`tee\\s+${LOG_PATH.replace(/\//g, "\\/").replace(/\./g, "\\.")}`, "g")) ?? [];
    expect(teeMatches).toHaveLength(1);

    // The tee line must be inside a `[ "$STICKY_DEBUG" = "1" ]` block.
    const idx = WORKFLOW.indexOf(`tee ${LOG_PATH}`);
    expect(idx).toBeGreaterThan(0);
    const before = WORKFLOW.slice(Math.max(0, idx - 400), idx);
    expect(before).toMatch(/if\s*\[\s*"\$STICKY_DEBUG"\s*=\s*"1"\s*\]/);
  });

  it("a defensive purge step removes any stale log when sticky_debug != '1'", () => {
    const purgeBlock = WORKFLOW.match(
      /-\s*name:\s*Sticky-upsert perf timing log[^\n]*\n[\s\S]+?run:\s*rm\s+-f\s+reports\/_ci\/sticky-upsert-perf-timing\.log/,
    );
    expect(purgeBlock, "expected a purge step that rm -f's the timing log").toBeTruthy();
    const block = purgeBlock![0];
    // Gate must exclude the debug=1 case (i.e. purge runs only when off).
    expect(block).toMatch(/if:\s*\$\{\{\s*inputs\.sticky_debug\s*!=\s*'1'\s*\}\}/);
  });

  it("the upload-artifact step is gated by sticky_debug == '1' (false for unset / '0')", () => {
    const uploadBlock = WORKFLOW.match(
      /-\s*if:[^\n]*sticky_debug\s*==\s*'1'[^\n]*\n\s*uses:\s*actions\/upload-artifact@v4[\s\S]+?path:\s*reports\/_ci\/sticky-upsert-perf-timing\.log/,
    );
    expect(uploadBlock, "upload-artifact step for the timing log not found / not gated").toBeTruthy();

    // Sanity: a literal `==` check on '1' is true only for '1'.
    const evalGate = (v: string | undefined) => v === "1";
    expect(evalGate(undefined)).toBe(false);
    expect(evalGate("0")).toBe(false);
    expect(evalGate("")).toBe(false);
    expect(evalGate("true")).toBe(false);
    expect(evalGate("1")).toBe(true);
  });

  it("no other tee/cp/mv writes the timing log path outside the debug-gated branch", () => {
    // Catches accidental future writes from helper scripts.
    const writers = [
      ...WORKFLOW.matchAll(/(tee|cp|mv|>)\s+[^\n]*sticky-upsert-perf-timing\.log/g),
    ];
    // Only the single guarded `tee` is allowed.
    expect(writers).toHaveLength(1);
    expect(writers[0][1]).toBe("tee");
  });
});
