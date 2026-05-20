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

/**
 * Optional rich return shape for `StickyApi.list`. When the API
 * implementation walks paginated GitHub responses internally it can
 * return `{ comments, pagesWalked }` so the upsert reports
 * `scanStats.pagesWalked` precisely. Plain `StickyComment[]` is still
 * accepted (treated as a single page) for backward compatibility.
 */
export interface StickyListMeta {
  comments: StickyComment[];
  pagesWalked: number;
}

export interface StickyApi {
  list: () => Promise<StickyComment[] | StickyListMeta>;
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

/**
 * Marker-scan statistics, returned so integration tests can assert the
 * `headScanLines` bound precisely (including across paginated lists,
 * empty pages, and full-body fallback rescues).
 *
 *   • `pagesWalked`      — pages the `list` impl reported walking
 *                          (defaults to 1 when the API returns a plain
 *                          array). Empty pages still count as walked.
 *   • `commentsExamined` — total comments returned by `list` (across
 *                          all pages).
 *   • `linesScanned`     — sum of body lines actually inspected across
 *                          BOTH the head scan and (when engaged) the
 *                          full-body fallback. Bounded per comment by
 *                          `headScanLines` on the fast path; the
 *                          fallback walks the full body once.
 */
export interface ScanStats {
  pagesWalked: number;
  commentsExamined: number;
  linesScanned: number;
}

export interface UpsertResult {
  action: "created" | "updated";
  comment: StickyComment;
  cleaned: { id: number; via: "delete" | "lock" }[];
  /** True if the matched comment was found via the full-body fallback. */
  usedFullScan: boolean;
  /** See `ScanStats`. Always populated. */
  scanStats: ScanStats;
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
 * Like {@link hasStickyMarker} but also returns the number of lines it
 * actually inspected so callers can roll up a precise `linesScanned`
 * total (used by `ScanStats`). Stops early on first match.
 */
function scanForMarker(
  body: unknown,
  marker: string,
  opts: { headScanLines?: number; fullScan?: boolean } = {},
): { matched: boolean; linesScanned: number } {
  if (typeof body !== "string" || body.length === 0) {
    return { matched: false, linesScanned: 0 };
  }
  const normalized = body.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const allLines = normalized.split("\n");
  const limit = opts.fullScan
    ? allLines.length
    : Math.min(allLines.length, opts.headScanLines ?? MARKER_HEAD_SCAN_LINES);
  const target = marker.trim();
  for (let i = 0; i < limit; i++) {
    if (allLines[i].trim() === target) return { matched: true, linesScanned: i + 1 };
  }
  return { matched: false, linesScanned: limit };
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

  const listed = await api.list();
  const isMeta = !Array.isArray(listed);
  const comments: StickyComment[] = isMeta ? listed.comments : listed;
  const pagesWalked = isMeta ? listed.pagesWalked : 1;

  const stamped = hasStickyMarker(body, marker, { headScanLines: 1 })
    ? body
    : `${marker}\n${body}`;

  let linesScanned = 0;
  const headMatches: StickyComment[] = [];
  for (const c of comments) {
    const r = scanForMarker(c.body, marker, { headScanLines });
    linesScanned += r.linesScanned;
    if (r.matched) headMatches.push(c);
  }
  let matches = headMatches;
  let usedFullScan = false;

  if (matches.length === 0) {
    const fullMatches: StickyComment[] = [];
    for (const c of comments) {
      const r = scanForMarker(c.body, marker, { fullScan: true });
      linesScanned += r.linesScanned;
      if (r.matched) fullMatches.push(c);
    }
    matches = fullMatches;
    usedFullScan = matches.length > 0;
  }

  const scanStats: ScanStats = {
    pagesWalked,
    commentsExamined: comments.length,
    linesScanned,
  };

  if (matches.length === 0) {
    const created = await api.create(stamped);
    log?.(`no existing marker found across ${comments.length} comment(s); created id=${created.id}`);
    log?.(
      `summary: action=created id=${created.id} cleaned=0 ` +
        `(deleted=0 tombstoned=0) ` +
        `requestedStrategy=${requestedStrategy} effectiveStrategy=${strategy}`,
    );
    return { action: "created", comment: created, cleaned: [], usedFullScan: false, scanStats };
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

  const deletedCount = cleaned.filter((c) => c.via === "delete").length;
  const lockedCount = cleaned.filter((c) => c.via === "lock").length;
  log?.(
    `summary: action=updated id=${updated.id} cleaned=${cleaned.length} ` +
      `(deleted=${deletedCount} tombstoned=${lockedCount}) ` +
      `requestedStrategy=${requestedStrategy} effectiveStrategy=${strategy}`,
  );

  return { action: "updated", comment: updated, cleaned, usedFullScan, scanStats };
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

// ──────────────────────────────────────────────────────────────────────
// main() — runs when invoked as a script (bun/node).
//
// Resolves config, builds a GitHub REST client from STICKY_REPO /
// STICKY_PR_NUMBER / GITHUB_TOKEN, then calls upsertStickyComment with
// debug logging when requested. If the GitHub envs are missing it
// prints the resolved config and exits 0 — the workflow step is best-
// effort cleanup, not a gate, so missing creds shouldn't fail CI.
// ──────────────────────────────────────────────────────────────────────

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  let cfg: ParsedCliConfig;
  try {
    cfg = parseCliConfig(argv, env as Record<string, string | undefined>);
  } catch (e) {
    console.error(`[sticky-upsert] ${(e as Error).message}`);
    console.error(HELP_TEXT);
    return 1;
  }
  if (cfg.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (!cfg.marker || !cfg.bodyFile) {
    console.error("[sticky-upsert] --marker and --body-file are required");
    console.error(HELP_TEXT);
    return 1;
  }

  const log = (l: string) => console.log(`[sticky-upsert] ${l}`);
  if (cfg.debug) {
    log(
      `config: cleanupStrategy=${cfg.cleanupStrategy} headScanLines=${cfg.headScanLines} ` +
        `marker=${JSON.stringify(cfg.marker)} bodyFile=${cfg.bodyFile}`,
    );
  }

  const token = env.GITHUB_TOKEN;
  const repo = env.STICKY_REPO;
  const prNumber = env.STICKY_PR_NUMBER;
  if (!token || !repo || !prNumber) {
    log(
      `skipping live upsert — missing ${[
        !token && "GITHUB_TOKEN",
        !repo && "STICKY_REPO",
        !prNumber && "STICKY_PR_NUMBER",
      ]
        .filter(Boolean)
        .join(", ")}; resolved config printed above.`,
    );
    return 0;
  }

  const fs = await import("node:fs/promises");
  const body = await fs.readFile(cfg.bodyFile, "utf8");

  const base = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const commentUrl = (id: number) =>
    `https://api.github.com/repos/${repo}/issues/comments/${id}`;

  const api: StickyApi = {
    list: async () => {
      const out: StickyComment[] = [];
      let pagesWalked = 0;
      for (let page = 1; page < 50; page++) {
        const r = await fetch(`${base}?per_page=100&page=${page}`, { headers });
        if (!r.ok) throw new Error(`list failed: ${r.status} ${await r.text()}`);
        const batch = (await r.json()) as Array<{ id: number; body: string }>;
        pagesWalked++;
        out.push(...batch.map((c) => ({ id: c.id, body: c.body ?? "" })));
        if (batch.length < 100) break;
      }
      return { comments: out, pagesWalked };
    },
    create: async (b) => {
      const r = await fetch(base, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body: b }),
      });
      if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
      const j = (await r.json()) as { id: number; body: string };
      return { id: j.id, body: j.body };
    },
    update: async (id, b) => {
      const r = await fetch(commentUrl(id), {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body: b }),
      });
      if (!r.ok) throw new Error(`update failed: ${r.status} ${await r.text()}`);
      const j = (await r.json()) as { id: number; body: string };
      return { id: j.id, body: j.body };
    },
    remove: async (id) => {
      const r = await fetch(commentUrl(id), { method: "DELETE", headers });
      if (!r.ok && r.status !== 404)
        throw new Error(`delete failed: ${r.status} ${await r.text()}`);
    },
  };

  try {
    const res = await upsertStickyComment({
      api,
      marker: cfg.marker,
      body,
      cleanupStrategy: cfg.cleanupStrategy,
      headScanLines: cfg.headScanLines,
      debug: cfg.debug ? log : false,
    });
    log(
      `done: action=${res.action} id=${res.comment.id} cleaned=${res.cleaned.length} ` +
        `usedFullScan=${res.usedFullScan}`,
    );
    return 0;
  } catch (e) {
    console.error(`[sticky-upsert] GitHub API error: ${(e as Error).message}`);
    return 2;
  }
}

// Auto-run when this file is the entrypoint. Guarded so vitest imports
// don't trigger network calls.
const isEntrypoint =
  typeof process !== "undefined" &&
  typeof import.meta !== "undefined" &&
  // @ts-expect-error import.meta.main is Bun-specific; falsy elsewhere.
  (import.meta.main === true ||
    (process.argv[1] && process.argv[1].endsWith("ci-sticky-pr-comment-upsert.ts")));

if (isEntrypoint) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
