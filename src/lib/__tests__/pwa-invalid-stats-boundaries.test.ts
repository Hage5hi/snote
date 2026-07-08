// Boundary + retention tests for pwa-invalid-stats aggregation.
// Focused on the 5m and 1h window edges: an event whose age equals the
// window (inclusive lower bound) must be counted; one 1ms older must not.
import { describe, it, expect } from "vitest";
import {
  computeInvalidStats,
  countInWindow,
  pruneInvalidTimestamps,
  INVALID_STATS_WINDOW_MS,
  INVALID_STATS_RETENTION_MS,
  loadPersistedInvalidStats,
  savePersistedInvalidStats,
  INVALID_STATS_STORAGE_KEY,
} from "../pwa-invalid-stats";

const NOW = 1_700_000_000_000;

describe("pwa-invalid-stats — bucket boundaries", () => {
  it("counts an event exactly at the 5m edge, drops one 1ms older", () => {
    const win = INVALID_STATS_WINDOW_MS["5m"];
    const ts = [NOW - win, NOW - win - 1, NOW - win + 1];
    expect(countInWindow(ts, NOW, win)).toBe(2);
  });

  it("counts an event exactly at the 1h edge, drops one 1ms older", () => {
    const win = INVALID_STATS_WINDOW_MS["1h"];
    const ts = [NOW - win, NOW - win - 1, NOW - 1];
    expect(countInWindow(ts, NOW, win)).toBe(2);
  });

  it("computeInvalidStats includes the exact-boundary event in windowCount for 5m", () => {
    const win = INVALID_STATS_WINDOW_MS["5m"];
    const ts = [NOW - win, NOW - 30_000];
    const stats = computeInvalidStats(ts, ts.length, NOW, "5m");
    expect(stats.windowCount).toBe(2);
    expect(stats.lastMinute).toBe(1);
  });

  it("computeInvalidStats includes the exact-boundary event in windowCount for 1h", () => {
    const win = INVALID_STATS_WINDOW_MS["1h"];
    const ts = [NOW - win, NOW - 10 * 60_000];
    const stats = computeInvalidStats(ts, ts.length, NOW, "1h");
    expect(stats.windowCount).toBe(2);
  });

  it("pruneInvalidTimestamps keeps events at the retention edge, drops older", () => {
    const ts = [NOW - INVALID_STATS_RETENTION_MS, NOW - INVALID_STATS_RETENTION_MS - 1, NOW];
    const pruned = pruneInvalidTimestamps(ts, NOW);
    expect(pruned).toEqual([NOW - INVALID_STATS_RETENTION_MS, NOW]);
  });
});

describe("pwa-invalid-stats — persistence", () => {
  function makeStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: (i) => Array.from(map.keys())[i] ?? null,
      get length() {
        return map.size;
      },
    } as Storage;
  }

  it("saves and reloads a snapshot round-trip", () => {
    const storage = makeStorage();
    const ts = [NOW - 30_000, NOW - 60_000];
    savePersistedInvalidStats({ total: 5, timestamps: ts }, storage);
    expect(storage.getItem(INVALID_STATS_STORAGE_KEY)).toContain("\"total\":5");
    const loaded = loadPersistedInvalidStats(storage, NOW);
    expect(loaded.total).toBe(5);
    expect(loaded.timestamps).toEqual(ts);
  });

  it("prunes stale timestamps on load beyond retention", () => {
    const storage = makeStorage();
    savePersistedInvalidStats(
      { total: 3, timestamps: [NOW - INVALID_STATS_RETENTION_MS - 1_000, NOW - 60_000] },
      storage,
    );
    const loaded = loadPersistedInvalidStats(storage, NOW);
    expect(loaded.timestamps).toEqual([NOW - 60_000]);
    expect(loaded.total).toBe(3);
  });

  it("returns empty snapshot when storage is null / entry missing / malformed", () => {
    expect(loadPersistedInvalidStats(null, NOW)).toEqual({ total: 0, timestamps: [] });
    const storage = makeStorage();
    expect(loadPersistedInvalidStats(storage, NOW)).toEqual({ total: 0, timestamps: [] });
    storage.setItem(INVALID_STATS_STORAGE_KEY, "not-json{{");
    expect(loadPersistedInvalidStats(storage, NOW)).toEqual({ total: 0, timestamps: [] });
  });
});
