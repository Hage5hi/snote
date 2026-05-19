// Validate a failure-breakdown JSON file (as emitted by
// scripts/ci-vitest-failure-summary.ts --json) against the expected
// schemaVersion and required keys before it is uploaded as an artifact
// or referenced from a sticky PR comment. Catches silent rendering
// regressions (empty file, wrong shape, future schema bump) loudly
// instead of letting reviewers click into a broken artifact.
//
// Usage:
//   bun run scripts/ci-validate-breakdown-json.ts <file> [<file> ...]
//     [--schema-version <n>] [--allow-missing]
//
// Exits non-zero on the first invalid file unless --allow-missing is
// passed (in which case a missing file is logged + skipped, but a file
// that exists and is malformed still fails).
import { existsSync, readFileSync } from "node:fs";

import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "./ci-vitest-failure-summary";

const REQUIRED_TOP_LEVEL = ["schemaVersion", "failureCount", "suiteCount", "failures"] as const;
const REQUIRED_FAILURE_KEYS = ["suite", "test", "diff"] as const;

export interface ValidationResult {
  file: string;
  ok: boolean;
  errors: string[];
}

export function validateBreakdown(
  file: string,
  raw: string,
  expectedSchemaVersion: number,
): ValidationResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { file, ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { file, ok: false, errors: ["payload is not a JSON object"] };
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
  if (typeof p.failureCount !== "number") errors.push("failureCount must be a number");
  if (typeof p.suiteCount !== "number") errors.push("suiteCount must be a number");
  if (!Array.isArray(p.failures)) {
    errors.push("failures must be an array");
  } else {
    p.failures.forEach((f, i) => {
      if (!f || typeof f !== "object") {
        errors.push(`failures[${i}]: not an object`);
        return;
      }
      const fr = f as Record<string, unknown>;
      for (const key of REQUIRED_FAILURE_KEYS) {
        if (!(key in fr)) errors.push(`failures[${i}]: missing key ${key}`);
      }
    });
  }
  return { file, ok: errors.length === 0, errors };
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
  const expected =
    schemaIdx >= 0 ? Number(args[schemaIdx + 1]) : FAILURE_BREAKDOWN_SCHEMA_VERSION;
  const files = args.filter(
    (a, i) =>
      !a.startsWith("--") && args[i - 1] !== "--schema-version",
  );

  if (files.length === 0) {
    console.error("usage: ci-validate-breakdown-json <file> [<file> ...] [--schema-version N] [--allow-missing]");
    process.exit(2);
  }

  let hadError = false;
  for (const file of files) {
    if (!existsSync(file)) {
      if (allowMissing) {
        console.log(`✓ ${file} — missing (allowed)`);
        continue;
      }
      console.error(`::error file=${file}::breakdown JSON missing`);
      hadError = true;
      continue;
    }
    const raw = readFileSync(file, "utf8");
    const result = validateBreakdown(file, raw, expected);
    if (result.ok) {
      console.log(`✓ ${file} — schemaVersion=${expected}, shape OK`);
    } else {
      hadError = true;
      for (const err of result.errors) {
        console.error(`::error file=${file}::breakdown validation failed — ${err}`);
      }
    }
  }
  process.exit(hadError ? 1 : 0);
}
