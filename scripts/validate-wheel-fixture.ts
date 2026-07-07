#!/usr/bin/env bun
// Validate that scripts/__fixtures__/wheel-diagnostics-failure contains every
// input file needed to run the replay fixture test locally and in CI.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ValidationResult = { ok: boolean; missing: string[]; errors: string[] };

const REQUIRED_FILES = ["wheel-diagnostics.json", "scroller.png"] as const;
const OPTIONAL_FILES = ["trace.zip"] as const;

export function validateWheelFixture(dir: string, opts: { requireTrace?: boolean } = {}): ValidationResult {
  const missing: string[] = [];
  const errors: string[] = [];
  const required = [...REQUIRED_FILES, ...(opts.requireTrace ? (["trace.zip"] as const) : [])];
  for (const name of required) {
    const p = join(dir, name);
    if (!existsSync(p) || statSync(p).size === 0) missing.push(name);
  }
  if (!missing.includes("wheel-diagnostics.json")) {
    try {
      const d = JSON.parse(readFileSync(join(dir, "wheel-diagnostics.json"), "utf8"));
      if (typeof d.schemaVersion !== "number") errors.push("wheel-diagnostics.json missing numeric schemaVersion");
      const hasReplay = Array.isArray(d.replay) && d.replay.length > 0;
      const hasWheelSamples = Array.isArray(d.wheelSamples) && d.wheelSamples.length > 0;
      const hasSelection = Array.isArray(d.selectionDragSamples) && d.selectionDragSamples.length > 0;
      if (!hasReplay && !hasWheelSamples && !hasSelection) {
        errors.push("wheel-diagnostics.json has no replay/wheelSamples/selectionDragSamples deltas");
      }
    } catch (e) {
      errors.push(`wheel-diagnostics.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const name of OPTIONAL_FILES) {
    if (opts.requireTrace) continue;
    const p = join(dir, name);
    if (existsSync(p) && statSync(p).size === 0) errors.push(`${name} exists but is empty`);
  }
  return { ok: missing.length === 0 && errors.length === 0, missing, errors };
}

if (import.meta.main) {
  const dir = process.argv[2] ?? join(process.cwd(), "scripts", "__fixtures__", "wheel-diagnostics-failure");
  const requireTrace = process.argv.includes("--require-trace");
  const res = validateWheelFixture(dir, { requireTrace });
  if (res.ok) { console.log(`✓ wheel fixture ok: ${dir}`); process.exit(0); }
  if (res.missing.length) console.error(`✖ missing files in ${dir}: ${res.missing.join(", ")}`);
  for (const err of res.errors) console.error(`✖ ${err}`);
  process.exit(1);
}
