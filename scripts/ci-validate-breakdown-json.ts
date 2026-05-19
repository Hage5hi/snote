// Validate a failure-breakdown JSON file (as emitted by
// scripts/ci-vitest-failure-summary.ts --json) against the expected
// schemaVersion and required keys before it is uploaded as an artifact
// or referenced from a sticky PR comment. Catches silent rendering
// regressions (empty file, wrong shape, future schema bump) loudly
// instead of letting reviewers click into a broken artifact.
//
// Kinds: the same parser emits "failure", "parity", and "flags"
// breakdown payloads. Each kind has its own expected schemaVersion
// constant exported below — today they all share the v1 parser shape,
// but keeping them per-kind lets a future bump to (e.g.) flags JSON
// happen independently without silently invalidating the others.
//
// Usage:
//   bun run scripts/ci-validate-breakdown-json.ts <file> [<file> ...]
//     [--schema-version <n>]          # override expected version for all files
//     [--kind failure|parity|flags|auto]  # default: auto (infer per file)
//     [--allow-missing]
//
// Exits non-zero on the first invalid file unless --allow-missing is
// passed (in which case a missing file is logged + skipped, but a file
// that exists and is malformed still fails).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "./ci-vitest-failure-summary";

/**
 * Per-kind expected schemaVersion constants. All currently track the
 * shared parser version, but are split so a future change can bump one
 * without silently invalidating the others.
 */
export const EXPECTED_SCHEMA_VERSIONS = {
  failure: FAILURE_BREAKDOWN_SCHEMA_VERSION,
  parity: FAILURE_BREAKDOWN_SCHEMA_VERSION,
  flags: FAILURE_BREAKDOWN_SCHEMA_VERSION,
} as const;

export type BreakdownKind = keyof typeof EXPECTED_SCHEMA_VERSIONS;

const REQUIRED_TOP_LEVEL = ["schemaVersion", "failureCount", "suiteCount", "failures"] as const;
const REQUIRED_FAILURE_KEYS = ["suite", "test", "diff"] as const;

export interface ValidationResult {
  file: string;
  kind: BreakdownKind | "unknown";
  ok: boolean;
  errors: string[];
}

/** Infer breakdown kind from a file path (e.g. parity-breakdown.json → parity). */
export function inferKind(file: string): BreakdownKind | "unknown" {
  const name = basename(file).toLowerCase();
  if (name.includes("parity")) return "parity";
  if (name.includes("flags")) return "flags";
  if (name.includes("failure")) return "failure";
  return "unknown";
}

export function validateBreakdown(
  file: string,
  raw: string,
  expectedSchemaVersion: number,
  kind: BreakdownKind | "unknown" = "unknown",
): ValidationResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { file, kind, ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { file, kind, ok: false, errors: ["payload is not a JSON object"] };
  }
  const p = parsed as Record<string, unknown>;
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in p)) errors.push(`missing required top-level key: ${key}`);
  }
  if (typeof p.schemaVersion === "number" && p.schemaVersion !== expectedSchemaVersion) {
    errors.push(
      `schemaVersion mismatch: got ${p.schemaVersion}, expected ${expectedSchemaVersion}`,
    );
  } else if ("schemaVersion" in p && typeof p.schemaVersion !== "number") {
    errors.push(`schemaVersion must be a number, got ${typeof p.schemaVersion}`);
  }
  if ("failureCount" in p && typeof p.failureCount !== "number") {
    errors.push("failureCount must be a number");
  }
  if ("suiteCount" in p && typeof p.suiteCount !== "number") {
    errors.push("suiteCount must be a number");
  }
  if ("failures" in p) {
    if (!Array.isArray(p.failures)) {
      errors.push("failures must be an array");
    } else {
      p.failures.forEach((f, i) => {
        if (!f || typeof f !== "object" || Array.isArray(f)) {
          errors.push(`failures[${i}]: not an object`);
          return;
        }
        const fr = f as Record<string, unknown>;
        for (const key of REQUIRED_FAILURE_KEYS) {
          if (!(key in fr)) errors.push(`failures[${i}]: missing key ${key}`);
        }
      });
    }
  }
  return { file, kind, ok: errors.length === 0, errors };
}

const invokedDirectly = (() => {
  try {
    const arg = process.argv[1] ?? "";
    return arg.endsWith("ci-validate-breakdown-json.ts") || arg.endsWith("ci-validate-breakdown-json.js");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const allowMissing = args.includes("--allow-missing");
  const schemaIdx = args.indexOf("--schema-version");
  const schemaOverride = schemaIdx >= 0 ? Number(args[schemaIdx + 1]) : undefined;
  const kindIdx = args.indexOf("--kind");
  const kindArg = kindIdx >= 0 ? args[kindIdx + 1] : "auto";
  const summaryJsonIdx = args.indexOf("--summary-json");
  const summaryJsonPath =
    summaryJsonIdx >= 0 ? args[summaryJsonIdx + 1] : undefined;
  const files = args.filter(
    (a, i) =>
      !a.startsWith("--") &&
      args[i - 1] !== "--schema-version" &&
      args[i - 1] !== "--kind" &&
      args[i - 1] !== "--summary-json",
  );

  if (files.length === 0) {
    console.error(
      "usage: ci-validate-breakdown-json <file> [<file> ...] [--schema-version N] [--kind failure|parity|flags|auto] [--summary-json <path>] [--allow-missing]",
    );
    process.exit(2);
  }

  // Per-kind tallies so reviewers see "parity: 1 ok / 0 failed,
  // flags: 0 ok / 1 failed, failure: missing(allowed)" at a glance
  // instead of having to count log lines.
  type Tally = { ok: number; failed: number; missing: number };
  const tallies: Record<string, Tally> = {};
  const bump = (kind: string, key: keyof Tally) => {
    tallies[kind] = tallies[kind] ?? { ok: 0, failed: 0, missing: 0 };
    tallies[kind][key] += 1;
  };

  let hadError = false;
  for (const file of files) {
    const kind: BreakdownKind | "unknown" =
      kindArg === "auto" || !kindArg
        ? inferKind(file)
        : (kindArg as BreakdownKind);
    const expected =
      schemaOverride !== undefined
        ? schemaOverride
        : kind !== "unknown"
          ? EXPECTED_SCHEMA_VERSIONS[kind]
          : FAILURE_BREAKDOWN_SCHEMA_VERSION;

    if (!existsSync(file)) {
      if (allowMissing) {
        console.log(`✓ ${file} — missing (allowed)`);
        bump(kind, "missing");
        continue;
      }
      console.error(`::error file=${file}::breakdown JSON missing`);
      hadError = true;
      bump(kind, "failed");
      continue;
    }
    const raw = readFileSync(file, "utf8");
    const result = validateBreakdown(file, raw, expected, kind);
    if (result.ok) {
      console.log(`✓ ${file} — kind=${kind}, schemaVersion=${expected}, shape OK`);
      bump(kind, "ok");
    } else {
      hadError = true;
      bump(kind, "failed");
      for (const err of result.errors) {
        console.error(`::error file=${file}::breakdown validation failed (kind=${kind}) — ${err}`);
      }
    }
  }

  // Per-kind summary line — printed even on success so dashboards can
  // grep `kind=parity ok=` deterministically.
  console.log("--- ci-validate-breakdown-json summary ---");
  for (const [kind, t] of Object.entries(tallies)) {
    console.log(`kind=${kind} ok=${t.ok} failed=${t.failed} missing=${t.missing}`);
  }

  // Machine-parsable summary: same per-kind counts plus an overall
  // ok/failed/missing rollup. Emitted on a marker-prefixed stdout line
  // (grep-friendly) and, when --summary-json <path> is passed, also
  // written to disk for downstream tooling (PR bots, dashboards, the
  // debug-bundle artifact).
  const totals = { ok: 0, failed: 0, missing: 0 };
  for (const t of Object.values(tallies)) {
    totals.ok += t.ok;
    totals.failed += t.failed;
    totals.missing += t.missing;
  }
  const summaryPayload = {
    schemaVersion: 1 as const,
    ok: !hadError,
    totals,
    perKind: tallies,
  };
  console.log(`SUMMARY_JSON=${JSON.stringify(summaryPayload)}`);
  if (summaryJsonPath) {
    mkdirSync(dirname(summaryJsonPath), { recursive: true });
    writeFileSync(summaryJsonPath, JSON.stringify(summaryPayload, null, 2));
  }

  process.exit(hadError ? 1 : 0);
}
