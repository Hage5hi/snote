// Sticky PR comment upsert with duplicate-marker cleanup.
//
// Problem: GitHub PR threads can accumulate multiple comments carrying
// the same sticky marker — manual pastes, retries that raced, or older
// CI runs from before the upsert logic existed. Without cleanup, each
// new rerun would either spawn yet another duplicate or update a stale
// one and leave reviewers reading conflicting artifact links.
//
// Contract:
//   1. If NO marker comment exists → create one.
//   2. If exactly ONE marker comment exists → update it in place.
//   3. If MULTIPLE marker comments exist → the NEWEST (highest id,
//      matching GitHub's monotonic comment ordering) is updated with
//      the fresh body, and ALL older duplicates are cleaned up.
//
// Cleanup strategies (configurable):
//   • "delete" (DEFAULT) — older duplicates are removed via deleteComment.
//     Preferred when the bot has delete permission; leaves the thread
//     fully converged to a single sticky comment.
//   • "lock"             — older duplicates are rewritten to a tombstone
//     body that no longer carries the marker. Use when the bot lacks
//     delete permission, or when an audit trail is desired.
//
// Marker scanning is bounded:
//   • Head scan: first MARKER_HEAD_SCAN_LINES (5) lines of each comment.
//     This is the fast path and covers ~all real-world cases.
//   • Full scan: opt-in fallback that walks every line. Linear in body
//     length but still bounded per comment; used by upsert when the
//     head scan finds zero matches across the thread, so a deeply
//     buried marker (e.g. preceded by a long quoted log) is still
//     recognized rather than producing a duplicate.
//
// See scripts/__tests__/ci-sticky-pr-comment-{auto-cleanup,
// deep-marker,scan-bounded,cleanup-no-stale-links}.test.ts for the
// behavioral pins.

export const MARKER_HEAD_SCAN_LINES = 5;
export const DEFAULT_CLEANUP_STRATEGY: CleanupStrategy = "delete";
export const DEFAULT_TOMBSTONE =
  "<!-- superseded by newer sticky comment -->\n_This sticky comment was superseded by a more recent CI run._";

export type CleanupStrategy = "delete" | "lock";

export interface StickyComment {
  id: number;
  body: string;
}

export interface StickyApi {
  list: () => Promise<StickyComment[]>;
  create: (body: string) => Promise<StickyComment>;
  update: (id: number, body: string) => Promise<StickyComment>;
  remove?: (id: number) => Promise<void>;
}

export interface UpsertOptions {
  api: StickyApi;
  marker: string;
  body: string;
  /** Defaults to "delete". Falls back to "lock" if api.remove is missing. */
  cleanupStrategy?: CleanupStrategy;
  /** Body used to overwrite older duplicates when strategy = "lock". */
  tombstone?: string;
  /** Override the head-scan window. Tests use this to assert bounds. */
  headScanLines?: number;
  /**
   * When set, emit human-readable diagnostics describing which sticky
   * comment was selected as the newest and which older duplicates were
   * deleted or tombstoned. Pass `true` to log via console.log, or a
   * custom sink (CI logs, test capture). No-op when unset.
   */
  debug?: boolean | ((line: string) => void);
}

export interface UpsertResult {
  action: "created" | "updated";
  comment: StickyComment;
  cleaned: { id: number; via: "delete" | "lock" }[];
  /** True if the matched comment was found via the full-body fallback. */
  usedFullScan: boolean;
}


/**
 * Bounded marker scan. Tolerant of:
 *   - leading BOM
 *   - CR / LF / CRLF newlines
 *   - per-line leading/trailing whitespace (incl. NBSP, em-space)
 *
 * NOT tolerant of zero-width characters injected INSIDE the literal
 * marker — those produce false (safer to miss than to overwrite the
 * wrong comment).
 */
export function hasStickyMarker(
  body: unknown,
  marker: string,
  opts: { headScanLines?: number; fullScan?: boolean } = {},
): boolean {
  if (typeof body !== "string" || body.length === 0) return false;
  const normalized = body.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const allLines = normalized.split("\n");
  const lines = opts.fullScan
    ? allLines
    : allLines.slice(0, opts.headScanLines ?? MARKER_HEAD_SCAN_LINES);
  const target = marker.trim();
  for (const line of lines) {
    if (line.trim() === target) return true;
  }
  return false;
}

/**
 * Upsert a sticky comment, cleaning up any older duplicates carrying
 * the same marker. See module docstring for the full contract.
 */
export async function upsertStickyComment(opts: UpsertOptions): Promise<UpsertResult> {
  const {
    api,
    marker,
    body,
    tombstone = DEFAULT_TOMBSTONE,
    headScanLines = MARKER_HEAD_SCAN_LINES,
  } = opts;
  const requestedStrategy = opts.cleanupStrategy ?? DEFAULT_CLEANUP_STRATEGY;
  const strategy: CleanupStrategy =
    requestedStrategy === "delete" && typeof api.remove !== "function" ? "lock" : requestedStrategy;
  const log =
    opts.debug === true
      ? (l: string) => console.log(`[sticky-upsert] ${l}`)
      : typeof opts.debug === "function"
        ? opts.debug
        : null;

  const comments = await api.list();

  const stamped = hasStickyMarker(body, marker, { headScanLines: 1 })
    ? body
    : `${marker}\n${body}`;

  let matches = comments.filter((c) => hasStickyMarker(c.body, marker, { headScanLines }));
  let usedFullScan = false;

  if (matches.length === 0) {
    matches = comments.filter((c) => hasStickyMarker(c.body, marker, { fullScan: true }));
    usedFullScan = matches.length > 0;
  }

  if (matches.length === 0) {
    const created = await api.create(stamped);
    log?.(`no existing marker found across ${comments.length} comment(s); created id=${created.id}`);
    return { action: "created", comment: created, cleaned: [], usedFullScan: false };
  }

  const newest = matches.reduce((a, b) => (a.id > b.id ? a : b));
  const updated = await api.update(newest.id, stamped);
  log?.(
    `selected newest sticky comment id=${newest.id} from ${matches.length} marker match(es)` +
      (usedFullScan ? " (via full-body fallback scan)" : "") +
      `; cleanup strategy=${strategy}` +
      (strategy !== requestedStrategy ? ` (requested ${requestedStrategy}, fell back to lock)` : ""),
  );

  const cleaned: UpsertResult["cleaned"] = [];
  const stale = matches.filter((c) => c.id !== newest.id);
  for (const old of stale) {
    if (strategy === "delete" && api.remove) {
      await api.remove(old.id);
      cleaned.push({ id: old.id, via: "delete" });
      log?.(`deleted older duplicate sticky comment id=${old.id}`);
    } else {
      await api.update(old.id, tombstone);
      cleaned.push({ id: old.id, via: "lock" });
      log?.(`tombstoned older duplicate sticky comment id=${old.id}`);
    }
  }
  if (stale.length === 0) log?.(`no older duplicates to clean up`);

  return { action: "updated", comment: updated, cleaned, usedFullScan };
}


// ──────────────────────────────────────────────────────────────────────
// CLI surface
// ──────────────────────────────────────────────────────────────────────
//
// Usage (invoked from CI):
//   bun run scripts/ci-sticky-pr-comment-upsert.ts \
//     --marker "<!-- Sticky Pull Request Commenti18n-cli-coverage -->" \
//     --body-file reports/_ci/coverage-pr-comment.md \
//     [--cleanup-strategy delete|lock] \
//     [--head-scan-lines 5]
//
// Environment variables (lower precedence than flags):
//   STICKY_CLEANUP_STRATEGY   delete | lock     (default: delete)
//   STICKY_HEAD_SCAN_LINES    positive integer  (default: 5)
//
// Cleanup strategies:
//   • delete (DEFAULT) — older marker duplicates are removed via the
//                        GitHub deleteComment API. The thread converges
//                        to exactly one sticky comment. Requires
//                        `pull-requests: write` AND delete permission
//                        on issue comments for the bot identity.
//   • lock             — older duplicates are rewritten to a tombstone
//                        body that no longer carries the marker. Use
//                        when the bot lacks delete permission, or when
//                        you want an audit trail of prior runs. The
//                        next rerun will ignore tombstones because
//                        their bodies do not match the marker.
//
// If `--cleanup-strategy delete` is requested but the GitHub API client
// is constructed without delete capability, the upsert silently falls
// back to `lock` (see UpsertOptions / DEFAULT_CLEANUP_STRATEGY).

export const HELP_TEXT = `ci-sticky-pr-comment-upsert — upsert a sticky PR comment with duplicate cleanup

USAGE
  bun run scripts/ci-sticky-pr-comment-upsert.ts [flags]

FLAGS
  --marker <string>             Required. HTML-comment marker that identifies the sticky comment.
  --body-file <path>            Required. Path to the rendered comment body (markdown).
  --cleanup-strategy <strategy> Optional. One of: delete | lock. Default: delete.
                                  • delete (DEFAULT) — remove older duplicate marker comments.
                                  • lock             — rewrite older duplicates to a tombstone
                                                       body that no longer carries the marker.
                                  Falls back to "lock" automatically if the API client lacks
                                  delete permission.
  --head-scan-lines <n>         Optional. Lines per comment to scan for the marker on the fast
                                  path. Default: ${MARKER_HEAD_SCAN_LINES}. A full-body fallback
                                  runs only if the head scan finds zero matches across the thread.
  --debug                       Optional. Print which sticky comment was selected as newest, and
                                  whether older duplicates were deleted or tombstoned. Also enabled
                                  by STICKY_DEBUG=1.
  -h, --help                    Show this help.

ENVIRONMENT VARIABLES (lower precedence than flags)
  STICKY_CLEANUP_STRATEGY   delete | lock
  STICKY_HEAD_SCAN_LINES    positive integer
  STICKY_DEBUG              1 to enable selection / cleanup diagnostics

EXIT CODES
  0  upserted (created or updated); cleanup completed
  1  bad flags / missing required input
  2  GitHub API error
`;

export interface ParsedCliConfig {
  marker?: string;
  bodyFile?: string;
  cleanupStrategy: CleanupStrategy;
  headScanLines: number;
  debug: boolean;
  help: boolean;
}


/**
 * Parse argv + env into a config. Flags win over env. Invalid values
 * for cleanupStrategy throw — silent fallbacks here would mask CI
 * misconfiguration.
 */
export function parseCliConfig(
  argv: string[],
  env: Record<string, string | undefined> = {},
): ParsedCliConfig {
  const out: ParsedCliConfig = {
    cleanupStrategy: parseStrategy(env.STICKY_CLEANUP_STRATEGY, DEFAULT_CLEANUP_STRATEGY),
    headScanLines: parsePositiveInt(env.STICKY_HEAD_SCAN_LINES, MARKER_HEAD_SCAN_LINES),
    debug: env.STICKY_DEBUG === "1" || env.STICKY_DEBUG === "true",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    switch (a) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--debug":
        out.debug = true;
        break;

      case "--marker":
        out.marker = take();
        break;
      case "--body-file":
        out.bodyFile = take();
        break;
      case "--cleanup-strategy":
        out.cleanupStrategy = parseStrategy(take(), DEFAULT_CLEANUP_STRATEGY, /* strict */ true);
        break;
      case "--head-scan-lines":
        out.headScanLines = parsePositiveInt(take(), MARKER_HEAD_SCAN_LINES, /* strict */ true);
        break;
      default:
        if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    }
  }
  return out;
}

function parseStrategy(
  raw: string | undefined,
  fallback: CleanupStrategy,
  strict = false,
): CleanupStrategy {
  if (raw == null || raw === "") return fallback;
  if (raw === "delete" || raw === "lock") return raw;
  if (strict) throw new Error(`Invalid cleanup strategy: ${raw} (expected "delete" or "lock")`);
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number, strict = false): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    if (strict) throw new Error(`Invalid positive integer: ${raw}`);
    return fallback;
  }
  return n;
}
