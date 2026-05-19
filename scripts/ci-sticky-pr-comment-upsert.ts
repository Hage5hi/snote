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

  const comments = await api.list();

  // Ensure the body we write ALWAYS carries the marker on its own
  // first line — so subsequent reruns can find it via the head scan.
  const stamped = hasStickyMarker(body, marker, { headScanLines: 1 })
    ? body
    : `${marker}\n${body}`;

  // Phase 1: bounded head scan.
  let matches = comments.filter((c) => hasStickyMarker(c.body, marker, { headScanLines }));
  let usedFullScan = false;

  // Phase 2: full-scan fallback only if head scan found nothing.
  if (matches.length === 0) {
    matches = comments.filter((c) => hasStickyMarker(c.body, marker, { fullScan: true }));
    usedFullScan = matches.length > 0;
  }

  if (matches.length === 0) {
    const created = await api.create(stamped);
    return { action: "created", comment: created, cleaned: [], usedFullScan: false };
  }

  if (matches.length === 0) {
    const created = await api.create(body);
    return { action: "created", comment: created, cleaned: [], usedFullScan: false };
  }

  // Newest = highest id (GitHub comment ids are monotonic).
  const newest = matches.reduce((a, b) => (a.id > b.id ? a : b));
  const updated = await api.update(newest.id, body);

  const cleaned: UpsertResult["cleaned"] = [];
  const stale = matches.filter((c) => c.id !== newest.id);
  for (const old of stale) {
    if (strategy === "delete" && api.remove) {
      await api.remove(old.id);
      cleaned.push({ id: old.id, via: "delete" });
    } else {
      await api.update(old.id, tombstone);
      cleaned.push({ id: old.id, via: "lock" });
    }
  }

  return { action: "updated", comment: updated, cleaned, usedFullScan };
}
