// Idempotency helper for the CI "Append artifact links to step-summary.md"
// step. Strips any prior debug-links block (delimited by the HTML-comment
// markers below) from a markdown file in-place, so the next append doesn't
// stack duplicates on reruns of the same step.
//
// Markers (must match what the workflow writes around the block):
//   <!-- ci-debug-links:begin -->
//   ...links...
//   <!-- ci-debug-links:end -->
//
// Usage:
//   bun run scripts/ci-strip-debug-links.ts <file>
//
// Exits 0 even when the file is missing — append step then just creates it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const BEGIN_MARKER = "<!-- ci-debug-links:begin -->";
export const END_MARKER = "<!-- ci-debug-links:end -->";

/**
 * Remove every begin/end-delimited debug-links block from `input`,
 * including the marker lines themselves. Tolerant to:
 *   • multiple stacked blocks from earlier failed reruns
 *   • leading whitespace before markers
 *   • CRLF line endings
 *   • an unterminated trailing block (drops the begin marker + tail)
 */
export function stripDebugLinksBlocks(input: string): string {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!skipping && trimmed === BEGIN_MARKER) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (trimmed === END_MARKER) skipping = false;
      continue;
    }
    out.push(line);
  }
  // Collapse trailing blank lines left behind by the removed block(s).
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out.join(eol);
}

const invokedDirectly = (() => {
  try {
    const arg = process.argv[1] ?? "";
    return arg.endsWith("ci-strip-debug-links.ts") || arg.endsWith("ci-strip-debug-links.js");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: ci-strip-debug-links <file>");
    process.exit(2);
  }
  if (!existsSync(file)) process.exit(0);
  const raw = readFileSync(file, "utf8");
  writeFileSync(file, stripDebugLinksBlocks(raw));
}
