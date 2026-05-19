// Renders the debug-artifacts block appended to reports/_ci/step-summary.md
// after CI artifact uploads. Emits the EXACT begin/end HTML-comment
// markers that scripts/ci-strip-debug-links.ts looks for, so a rerun
// of the append step is idempotent (strip → append produces the same
// markdown whether run once or three times).
//
// Extracted from inline bash in .github/workflows/ci.yml so:
//   1. the markers are produced from a single source of truth
//      (BEGIN_MARKER / END_MARKER imported from ci-strip-debug-links)
//   2. unit tests can pin both the markers AND the link_or_missing
//      degraded form ("_artifact not uploaded_") across reruns.
//
// Usage (CLI):
//   bun run scripts/ci-append-debug-links.ts <step-summary.md>
//     [--header "Debug artifacts (ubuntu-latest)"]
//     [--link id=<artifact-id> label="📦 debug-bundle"]
//     [--link id= label="📝 step-summary.md"]   # missing id → degraded line
//
// Reads GITHUB_SERVER_URL / GITHUB_REPOSITORY / GITHUB_RUN_ID for URLs.
// Appends to the live $GITHUB_STEP_SUMMARY when set.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  BEGIN_MARKER,
  END_MARKER,
  stripDebugLinksBlocks,
} from "./ci-strip-debug-links";

export interface DebugLink {
  /** Artifact id from actions/upload-artifact@v4 outputs.artifact-id. */
  id?: string;
  /** Human label, e.g. "📦 debug-bundle (all of the above + raw log)". */
  label: string;
}

export interface RenderDebugLinksOptions {
  runUrl: string;
  /** Header for the block, e.g. "Debug artifacts" or "... (ubuntu-latest)". */
  header: string;
  links: DebugLink[];
}

/** Single-line bullet — link form when id present, degraded line otherwise. */
export function renderLinkLine(link: DebugLink, runUrl: string): string {
  if (link.id && link.id.trim() !== "") {
    return `- [${link.label}](${runUrl}/artifacts/${link.id})`;
  }
  return `- _${link.label}: artifact not uploaded_`;
}

/**
 * Render the full begin/end-delimited debug-links block, including the
 * exact markers required for idempotency. Pure: no I/O.
 *
 * The first line is always `BEGIN_MARKER` and the last line is always
 * `END_MARKER`, with NO surrounding whitespace inside the markers —
 * `stripDebugLinksBlocks` matches markers via `trim() === MARKER`, but
 * keeping them flush eliminates any ambiguity for the test suite.
 */
export function renderDebugLinksBlock(opts: RenderDebugLinksOptions): string {
  const { runUrl, header, links } = opts;
  const out: string[] = [];
  out.push(BEGIN_MARKER);
  out.push("---");
  out.push("");
  out.push(`#### ${header}`);
  for (const l of links) out.push(renderLinkLine(l, runUrl));
  out.push(END_MARKER);
  return out.join("\n");
}

/**
 * Strip any prior debug-links block from `file`, then append a fresh
 * one. Idempotent across reruns thanks to the shared markers + the
 * `stripDebugLinksBlocks` helper.
 */
export function rewriteStepSummaryWithDebugLinks(
  file: string,
  opts: RenderDebugLinksOptions,
): string {
  const prior = existsSync(file) ? readFileSync(file, "utf8") : "";
  const stripped = stripDebugLinksBlocks(prior);
  const eol = prior.includes("\r\n") ? "\r\n" : "\n";
  const block = renderDebugLinksBlock(opts);
  const next = (stripped.length ? stripped + eol + eol : "") + block + eol;
  writeFileSync(file, next);
  return next;
}

function parseLinkArgs(args: string[]): DebugLink[] {
  // Format: --link id=<id> label="<label>"
  // Repeated --link flags accepted in order.
  const links: DebugLink[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--link") continue;
    const id = (args[i + 1] ?? "").startsWith("id=")
      ? args[i + 1].slice(3)
      : "";
    const labelArg = args[i + 2] ?? "";
    const label = labelArg.startsWith("label=")
      ? labelArg.slice("label=".length)
      : "";
    links.push({ id, label });
    i += 2;
  }
  return links;
}

const invokedDirectly = (() => {
  try {
    const arg = process.argv[1] ?? "";
    return (
      arg.endsWith("ci-append-debug-links.ts") ||
      arg.endsWith("ci-append-debug-links.js")
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error(
      "usage: ci-append-debug-links <file> [--header H] [--link id=<id> label=<label> ...]",
    );
    process.exit(2);
  }
  const headerIdx = args.indexOf("--header");
  const header =
    headerIdx >= 0 ? args[headerIdx + 1] ?? "Debug artifacts" : "Debug artifacts";
  const env = process.env;
  const runUrl = `${env.GITHUB_SERVER_URL || "https://github.com"}/${
    env.GITHUB_REPOSITORY || "<owner>/<repo>"
  }/actions/runs/${env.GITHUB_RUN_ID || "0"}`;
  const links = parseLinkArgs(args);
  const next = rewriteStepSummaryWithDebugLinks(file, { runUrl, header, links });
  // Mirror the same block to the live GitHub step summary so the job UI
  // shows the links inline too.
  const ghss = env.GITHUB_STEP_SUMMARY;
  if (ghss) {
    try {
      appendFileSync(ghss, "\n" + renderDebugLinksBlock({ runUrl, header, links }) + "\n");
    } catch {
      /* best-effort */
    }
  }
  process.stdout.write(next.slice(-2048));
}
