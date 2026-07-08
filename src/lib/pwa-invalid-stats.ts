// Pure helpers for aggregating `snote:pwa-readiness-invalid` event
// timestamps into rolling-window frequency stats. Extracted from
// <PwaUpdateDebugPanel> so we can unit-test the math without a DOM.

export type InvalidStatsWindow = "5m" | "1h" | "24h";

export const INVALID_STATS_WINDOW_MS: Record<InvalidStatsWindow, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

/** Retention cap for the timestamps buffer (matches the largest window). */
export const INVALID_STATS_RETENTION_MS = INVALID_STATS_WINDOW_MS["24h"];

export type InvalidStats = {
  total: number;
  lastMinute: number;
  window: InvalidStatsWindow;
  windowCount: number;
  lastAt: number | null;
};

/** Drop timestamps older than the retention cap. Returns a NEW array. */
export function pruneInvalidTimestamps(timestamps: readonly number[], now: number): number[] {
  const cutoff = now - INVALID_STATS_RETENTION_MS;
  return timestamps.filter((t) => t >= cutoff);
}

/** Count timestamps within `[now-windowMs, now]`. */
export function countInWindow(timestamps: readonly number[], now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  let n = 0;
  for (const t of timestamps) if (t >= cutoff) n += 1;
  return n;
}

export function computeInvalidStats(
  timestamps: readonly number[],
  total: number,
  now: number,
  window: InvalidStatsWindow,
): InvalidStats {
  return {
    total,
    lastMinute: countInWindow(timestamps, now, 60_000),
    window,
    windowCount: countInWindow(timestamps, now, INVALID_STATS_WINDOW_MS[window]),
    lastAt: timestamps.length ? timestamps[timestamps.length - 1] : null,
  };
}

/** sessionStorage key for short-lived persistence of the invalid-events buffer. */
export const INVALID_STATS_STORAGE_KEY = "snote:pwa-invalid-stats:v1";

export type PersistedInvalidStats = { total: number; timestamps: number[] };

/** Best-effort read of the persisted stats snapshot. Never throws. */
export function loadPersistedInvalidStats(
  storage: Pick<Storage, "getItem"> | null | undefined = typeof sessionStorage !== "undefined"
    ? sessionStorage
    : null,
  now: number = Date.now(),
): PersistedInvalidStats {
  const empty: PersistedInvalidStats = { total: 0, timestamps: [] };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(INVALID_STATS_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PersistedInvalidStats> | null;
    if (!parsed || typeof parsed !== "object") return empty;
    const total = typeof parsed.total === "number" && Number.isFinite(parsed.total) ? parsed.total : 0;
    const timestamps = Array.isArray(parsed.timestamps)
      ? parsed.timestamps.filter((t): t is number => typeof t === "number" && Number.isFinite(t))
      : [];
    return { total, timestamps: pruneInvalidTimestamps(timestamps, now) };
  } catch {
    return empty;
  }
}

/** Best-effort write of the persisted stats snapshot. Never throws. */
export function savePersistedInvalidStats(
  snapshot: PersistedInvalidStats,
  storage: Pick<Storage, "setItem"> | null | undefined = typeof sessionStorage !== "undefined"
    ? sessionStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(INVALID_STATS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / disabled — ignore */
  }
}

/** Serialize stats + raw timestamps to CSV for staging troubleshooting. */
export function invalidStatsToCsv(stats: InvalidStats, timestamps: readonly number[], now = Date.now()): string {
  const rows: string[] = [];
  rows.push("section,key,value");
  rows.push(`summary,generatedAtIso,${new Date(now).toISOString()}`);
  rows.push(`summary,total,${stats.total}`);
  rows.push(`summary,lastMinute,${stats.lastMinute}`);
  rows.push(`summary,window,${stats.window}`);
  rows.push(`summary,windowCount,${stats.windowCount}`);
  rows.push(`summary,lastAtIso,${stats.lastAt ? new Date(stats.lastAt).toISOString() : ""}`);
  rows.push("");
  rows.push("event,index,timestampMs,timestampIso");
  timestamps.forEach((t, i) => {
    rows.push(`event,${i},${t},${new Date(t).toISOString()}`);
  });
  return rows.join("\n") + "\n";
}
