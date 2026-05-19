// Unit tests for scripts/ci-validate-breakdown-json.ts — exercises
// failure / parity / flags breakdown payloads against the validator,
// covering happy paths plus the common silent-rendering regressions:
//
//   • wrong schemaVersion (e.g. future bump shipped without consumer update)
//   • missing required top-level keys
//   • malformed entries inside failures[]
//   • non-object payloads + unparseable JSON
//   • kind inference from filename
//
// We construct payloads in-memory and call validateBreakdown directly so
// the test stays hermetic (no fs / subprocess), and we assert on the
// returned ValidationResult shape rather than the CLI exit code.
import { describe, expect, it } from "vitest";
import {
  EXPECTED_SCHEMA_VERSIONS,
  inferKind,
  validateBreakdown,
} from "../ci-validate-breakdown-json";
import {
  FAILURE_BREAKDOWN_SCHEMA_VERSION,
  renderJson,
} from "../ci-vitest-failure-summary";

const validPayload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: FAILURE_BREAKDOWN_SCHEMA_VERSION,
    failureCount: 1,
    suiteCount: 1,
    failures: [{ suite: "a.test.ts", test: "x > y", diff: "boom" }],
    ...overrides,
  });

describe("ci-validate-breakdown-json", () => {
  describe("inferKind", () => {
    it("infers failure / parity / flags from filename", () => {
      expect(inferKind("reports/_ci/failure-breakdown.json")).toBe("failure");
      expect(inferKind("reports/_ci/parity-breakdown.json")).toBe("parity");
      expect(inferKind("reports/_ci/flags-breakdown.json")).toBe("flags");
      expect(inferKind("reports/_ci/unrelated.json")).toBe("unknown");
    });
  });

  describe("happy paths per kind", () => {
    for (const kind of ["failure", "parity", "flags"] as const) {
      it(`accepts a well-formed ${kind} payload at the expected schemaVersion`, () => {
        const res = validateBreakdown(
          `${kind}-breakdown.json`,
          validPayload(),
          EXPECTED_SCHEMA_VERSIONS[kind],
          kind,
        );
        expect(res.ok).toBe(true);
        expect(res.errors).toEqual([]);
        expect(res.kind).toBe(kind);
      });
    }

    it("accepts the live renderer output (empty + non-empty failures)", () => {
      const empty = renderJson([]);
      const nonEmpty = renderJson([{ file: "a.test.ts", test: "x", diff: ["err"] }]);
      for (const raw of [empty, nonEmpty]) {
        const res = validateBreakdown("failure-breakdown.json", raw, FAILURE_BREAKDOWN_SCHEMA_VERSION, "failure");
        expect(res.ok).toBe(true);
        expect(res.errors).toEqual([]);
      }
    });
  });

  describe("invalid payloads", () => {
    it("flags wrong schemaVersion", () => {
      const res = validateBreakdown(
        "failure-breakdown.json",
        validPayload({ schemaVersion: 99 }),
        FAILURE_BREAKDOWN_SCHEMA_VERSION,
        "failure",
      );
      expect(res.ok).toBe(false);
      expect(res.errors.join("\n")).toMatch(/schemaVersion mismatch: got 99, expected 1/);
    });

    it("flags non-numeric schemaVersion", () => {
      const res = validateBreakdown(
        "parity-breakdown.json",
        validPayload({ schemaVersion: "1" }),
        EXPECTED_SCHEMA_VERSIONS.parity,
        "parity",
      );
      expect(res.ok).toBe(false);
      expect(res.errors.join("\n")).toMatch(/schemaVersion must be a number/);
    });

    it("flags missing required top-level keys", () => {
      const raw = JSON.stringify({ schemaVersion: FAILURE_BREAKDOWN_SCHEMA_VERSION });
      const res = validateBreakdown("flags-breakdown.json", raw, EXPECTED_SCHEMA_VERSIONS.flags, "flags");
      expect(res.ok).toBe(false);
      const joined = res.errors.join("\n");
      expect(joined).toMatch(/missing required top-level key: failureCount/);
      expect(joined).toMatch(/missing required top-level key: suiteCount/);
      expect(joined).toMatch(/missing required top-level key: failures/);
    });

    it("flags malformed failures[] entries (not an object + missing keys)", () => {
      const raw = JSON.stringify({
        schemaVersion: FAILURE_BREAKDOWN_SCHEMA_VERSION,
        failureCount: 2,
        suiteCount: 1,
        failures: ["not-an-object", { suite: "only.test.ts" }],
      });
      const res = validateBreakdown("failure-breakdown.json", raw, FAILURE_BREAKDOWN_SCHEMA_VERSION, "failure");
      expect(res.ok).toBe(false);
      const joined = res.errors.join("\n");
      expect(joined).toMatch(/failures\[0\]: not an object/);
      expect(joined).toMatch(/failures\[1\]: missing key test/);
      expect(joined).toMatch(/failures\[1\]: missing key diff/);
    });

    it("flags failures not being an array", () => {
      const raw = JSON.stringify({
        schemaVersion: FAILURE_BREAKDOWN_SCHEMA_VERSION,
        failureCount: 0,
        suiteCount: 0,
        failures: { nope: true },
      });
      const res = validateBreakdown("failure-breakdown.json", raw, FAILURE_BREAKDOWN_SCHEMA_VERSION, "failure");
      expect(res.ok).toBe(false);
      expect(res.errors.join("\n")).toMatch(/failures must be an array/);
    });

    it("flags unparseable JSON", () => {
      const res = validateBreakdown("failure-breakdown.json", "{not json", 1, "failure");
      expect(res.ok).toBe(false);
      expect(res.errors[0]).toMatch(/invalid JSON/);
    });

    it("flags non-object top-level payload (array)", () => {
      const res = validateBreakdown("flags-breakdown.json", "[]", 1, "flags");
      expect(res.ok).toBe(false);
      expect(res.errors[0]).toMatch(/payload is not a JSON object/);
    });

    it("flags non-numeric failureCount / suiteCount", () => {
      const raw = JSON.stringify({
        schemaVersion: FAILURE_BREAKDOWN_SCHEMA_VERSION,
        failureCount: "1",
        suiteCount: null,
        failures: [],
      });
      const res = validateBreakdown("parity-breakdown.json", raw, EXPECTED_SCHEMA_VERSIONS.parity, "parity");
      expect(res.ok).toBe(false);
      const joined = res.errors.join("\n");
      expect(joined).toMatch(/failureCount must be a number/);
      expect(joined).toMatch(/suiteCount must be a number/);
    });
  });
});
