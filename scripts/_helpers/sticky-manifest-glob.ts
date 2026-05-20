// Tiny glob resolver for sticky-artifacts-manifest entry patterns.
//
// Supports a single `*` wildcard in the LAST path segment only (e.g
// `coverage-*.json` or `bundles/coverage-*.json`). Directory parts are
// literal — no `**`, no character classes. This is intentionally
// limited so manifest patterns stay obvious and predictable.
//
// Returns absolute file paths sorted lexicographically for determinism.

import { readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve, dirname, basename, sep } from "node:path";

export function resolveManifestGlob(pattern: string, baseRoot: string): string[] {
  const abs = isAbsolute(pattern) ? pattern : resolve(baseRoot, pattern);
  const dir = dirname(abs);
  const tail = basename(abs);

  // Disallow wildcards in directory portion; keeps semantics obvious.
  if (dir.split(sep).some((seg) => seg.includes("*"))) {
    throw new Error(
      `manifest glob pattern "${pattern}" may only use * in the final path segment`,
    );
  }
  if (!tail.includes("*")) {
    // Treat as a literal path.
    try {
      if (statSync(abs).isFile()) return [abs];
    } catch {}
    return [];
  }
  const re = new RegExp(
    "^" + tail.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => re.test(n))
    .map((n) => resolve(dir, n))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}
