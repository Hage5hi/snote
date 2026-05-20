// Drift guard: the STICKY_DEBUG=1 vs unset/'0' artifact contract is
// documented in `docs/ci-sticky-pr-comment.md` and enforced by THREE
// independent gates in `.github/workflows/ci.yml`. If any of those
// gating expressions drifts (different operand, different value,
// removed entirely) this test fails the CI job loudly — the docs and
// the workflow are the single source of truth; you change them and
// this test together, or not at all.
//
// Existing tests in this directory pin individual aspects (perf-timing
// upload presence/absence, env toggling). This one pins the EXACT set
// of expressions, in one place, so future refactors of the workflow
// can't silently weaken the contract.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
const DOC = readFileSync(join(process.cwd(), "docs/ci-sticky-pr-comment.md"), "utf8");
const LOG_PATH = "reports/_ci/sticky-upsert-perf-timing.log";

describe("CI gating drift guard — STICKY_DEBUG artifact contract", () => {
  // ── Gate 1: tee only inside the STICKY_DEBUG=1 shell branch ──────
  it("tee gate: the perf log is written by exactly ONE `tee` call, inside `[ \"$STICKY_DEBUG\" = \"1\" ]`", () => {
    const teeRe = new RegExp(`tee\\s+${LOG_PATH.replace(/[/.]/g, (m) => "\\" + m)}`, "g");
    const tees = WORKFLOW.match(teeRe) ?? [];
    expect(tees, "exactly one tee writer is allowed").toHaveLength(1);

    const idx = WORKFLOW.indexOf(`tee ${LOG_PATH}`);
    expect(idx).toBeGreaterThan(0);
    const before = WORKFLOW.slice(Math.max(0, idx - 500), idx);
    expect(before, "tee must live inside an `if [ \"$STICKY_DEBUG\" = \"1\" ]` branch").toMatch(
      /if\s*\[\s*"\$STICKY_DEBUG"\s*=\s*"1"\s*\]/,
    );
  });

  // ── Gate 2: defensive purge runs when sticky_debug != '1' ─────────
  it("purge gate: an `rm -f` step is gated on `inputs.sticky_debug != '1'`", () => {
    const purge = WORKFLOW.match(
      /-\s*name:\s*Sticky-upsert perf timing log[^\n]*\n[\s\S]+?run:\s*rm\s+-f\s+reports\/_ci\/sticky-upsert-perf-timing\.log/,
    );
    expect(purge, "expected a Sticky-upsert perf timing log purge step").toBeTruthy();
    expect(purge![0]).toMatch(/if:\s*\$\{\{\s*inputs\.sticky_debug\s*!=\s*'1'\s*\}\}/);
  });

  // ── Gate 3: upload-artifact gated on sticky_debug == '1' ──────────
  it("upload gate: the artifact upload `if:` includes `inputs.sticky_debug == '1'`", () => {
    const upload = WORKFLOW.match(
      /-\s*if:[^\n]*sticky_debug\s*==\s*'1'[^\n]*\n\s*uses:\s*actions\/upload-artifact@v4[\s\S]+?path:\s*reports\/_ci\/sticky-upsert-perf-timing\.log/,
    );
    expect(upload, "upload-artifact step for the timing log not found / not gated on '1'").toBeTruthy();
  });

  // ── Drift sentinel: no OTHER comparison operator/value used ──────
  it("drift sentinel: no `sticky_debug` comparison uses anything other than the contracted '1'/'!='1'", () => {
    // Find every comparison of inputs.sticky_debug in the workflow.
    const comparisons = [...WORKFLOW.matchAll(/inputs\.sticky_debug\s*(==|!=)\s*'([^']*)'/g)];
    expect(comparisons.length, "expected at least the gate comparisons").toBeGreaterThanOrEqual(2);
    for (const m of comparisons) {
      const [, op, value] = m;
      // Only `== '1'` and `!= '1'` are allowed. Anything else is drift.
      expect(["== 1", "!= 1"], `unexpected comparison: ${m[0]}`).toContain(`${op} ${value}`);
    }
  });

  // ── Sentinel: no stray writers (cp/mv/> redirects) to the log path ─
  it("no other writers (cp/mv/>) target the perf timing log path", () => {
    const writers = [...WORKFLOW.matchAll(/(tee|cp|mv|>)\s+[^\n]*sticky-upsert-perf-timing\.log/g)];
    expect(writers, "exactly one writer (the gated tee) is allowed").toHaveLength(1);
    expect(writers[0][1]).toBe("tee");
  });

  // ── Docs ↔ workflow alignment: the doc table must mention all 3 gates ─
  it("docs/ci-sticky-pr-comment.md documents all three gates and the contracted expressions", () => {
    expect(DOC).toMatch(/STICKY_DEBUG/);
    expect(DOC).toMatch(/sticky_debug\s*==\s*'1'/);
    expect(DOC).toMatch(/sticky_debug\s*!=\s*'1'/);
    expect(DOC).toMatch(/\$STICKY_DEBUG"\s*=\s*"1"/);
    // The contract table rows.
    expect(DOC).toMatch(/unset.*no.*no/);
    expect(DOC).toMatch(/'0'.*no.*no/);
    expect(DOC).toMatch(/'1'.*yes.*yes/);
    // The doc names this very test as the drift guard.
    expect(DOC).toMatch(/ci-sticky-upsert-debug-gating-drift\.test\.ts/);
  });
});
