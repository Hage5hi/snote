/**
 * Burst clustering and hunk-level restore for local snapshot history.
 * Pure helpers over in-memory {ts, kind, content} rows — no IndexedDB version bump.
 */

import { structuredPatch } from "diff";
import type * as Y from "yjs";
import type { SnapshotKind } from "@/lib/snapshots";

/** Nearby snapshots within 15 minutes share a burst (1.5× the 10-minute periodic cadence). */
export const BURST_GAP_MS = 15 * 60_000;
export const HUNK_CONTEXT_LINES = 3;
export const LIVE_TEXT_MISMATCH = "live text mismatch";

export type BurstSnapshot = {
  ts: number;
  content: string;
  kind?: SnapshotKind;
  id?: number;
};

export type SnapshotBurst<T extends BurstSnapshot = BurstSnapshot> = {
  id: string;
  startTs: number;
  endTs: number;
  snapshots: T[];
  fromContent: string;
  toContent: string;
  vsCurrent: boolean;
};

export type HunkLine = {
  type: "context" | "add" | "remove";
  text: string;
};

export type DiffHunk = {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  oldStartChar: number;
  oldEndChar: number;
  newStartChar: number;
  newEndChar: number;
  lines: HunkLine[];
};

function toBurst<T extends BurstSnapshot>(snapshots: T[]): SnapshotBurst<T> {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  return {
    id: snapshots.map((s) => String(s.id ?? s.ts)).join("-"),
    startTs: first.ts,
    endTs: last.ts,
    snapshots,
    fromContent: first.content,
    toContent: last.content,
    vsCurrent: false,
  };
}

/**
 * Group snapshots whose timestamps are within `gapMs` of the previous one.
 * Returns newest-first. When `current` is provided, the newest burst is extended
 * to live content if nearby; otherwise a snapshot-vs-current burst is appended.
 */
export function clusterSnapshots<T extends BurstSnapshot>(
  items: T[],
  opts: {
    current?: { ts: number; content: string } | null;
    gapMs?: number;
    /** When false, skip a duplicate row-group for a distant live doc. Default true. */
    includeDistantCurrent?: boolean;
  } = {},
): SnapshotBurst<T>[] {
  const gapMs = opts.gapMs ?? BURST_GAP_MS;
  const sorted = [...items].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0));
  const groups: T[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (!last || item.ts - last[last.length - 1].ts > gapMs) groups.push([item]);
    else last.push(item);
  }
  const bursts = groups.map((group) => toBurst(group));
  const current = opts.current;
  const includeDistantCurrent = opts.includeDistantCurrent !== false;
  if (current && bursts.length > 0) {
    const last = bursts[bursts.length - 1];
    const latest = last.snapshots[last.snapshots.length - 1];
    if (current.ts - last.endTs <= gapMs) {
      last.toContent = current.content;
      last.endTs = current.ts;
      last.vsCurrent = true;
    } else if (includeDistantCurrent) {
      bursts.push({
        id: `current-${latest.id ?? latest.ts}`,
        startTs: latest.ts,
        endTs: current.ts,
        snapshots: [latest],
        fromContent: latest.content,
        toContent: current.content,
        vsCurrent: true,
      });
    }
  }
  return bursts.reverse();
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** Map a 1-based unified-diff line range onto character offsets in `text`. */
export function lineRangeChars(
  text: string,
  start1: number,
  count: number,
): { start: number; end: number } {
  const starts = lineStarts(text);
  if (count === 0) {
    if (start1 <= 0) return { start: 0, end: 0 };
    const pos = starts[start1] ?? text.length;
    return { start: pos, end: pos };
  }
  const from = Math.max(0, start1 - 1);
  const to = from + count;
  return {
    start: starts[from] ?? text.length,
    end: starts[to] ?? text.length,
  };
}

function parseHunkLine(raw: string): HunkLine | null {
  const tag = raw.charAt(0);
  const text = raw.slice(1);
  if (tag === " ") return { type: "context", text };
  if (tag === "-") return { type: "remove", text };
  if (tag === "+") return { type: "add", text };
  return null;
}

export function diffHunks(
  oldText: string,
  newText: string,
  contextLines = HUNK_CONTEXT_LINES,
): DiffHunk[] {
  const patch = structuredPatch("old", "new", oldText, newText, undefined, undefined, {
    context: contextLines,
  });
  return patch.hunks.map((hunk, index) => {
    const oldRange = lineRangeChars(oldText, hunk.oldStart, hunk.oldLines);
    const newRange = lineRangeChars(newText, hunk.newStart, hunk.newLines);
    const lines: HunkLine[] = [];
    for (const raw of hunk.lines) {
      const parsed = parseHunkLine(raw);
      if (parsed) lines.push(parsed);
    }
    return {
      id: `h${index}-${hunk.oldStart}-${hunk.newStart}`,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      oldStartChar: oldRange.start,
      oldEndChar: oldRange.end,
      newStartChar: newRange.start,
      newEndChar: newRange.end,
      lines,
    };
  });
}

export function applySelectedHunks(
  oldText: string,
  newText: string,
  hunks: DiffHunk[],
  selectedIds: readonly string[],
): string {
  const selected = new Set(selectedIds);
  const chosen = hunks
    .filter((h) => selected.has(h.id))
    .sort((a, b) => b.newStartChar - a.newStartChar);
  let out = newText;
  for (const h of chosen) {
    const insert = oldText.slice(h.oldStartChar, h.oldEndChar);
    out = out.slice(0, h.newStartChar) + insert + out.slice(h.newEndChar);
  }
  return out;
}

export function applySelectedHunksToYText(
  doc: Y.Doc,
  args: {
    oldText: string;
    newText: string;
    hunks: DiffHunk[];
    selectedIds: readonly string[];
  },
): void {
  const ytext = doc.getText("content");
  if (ytext.toString() !== args.newText) {
    throw new Error(LIVE_TEXT_MISMATCH);
  }
  const selected = new Set(args.selectedIds);
  const chosen = args.hunks
    .filter((h) => selected.has(h.id))
    .sort((a, b) => b.newStartChar - a.newStartChar);
  doc.transact(() => {
    for (const h of chosen) {
      const len = h.newEndChar - h.newStartChar;
      if (len > 0) ytext.delete(h.newStartChar, len);
      const insert = args.oldText.slice(h.oldStartChar, h.oldEndChar);
      if (insert.length > 0) ytext.insert(h.newStartChar, insert);
    }
  });
}
