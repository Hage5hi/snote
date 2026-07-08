import { describe, it, expect } from "vitest";
import {
  computeInvalidStats,
  countInWindow,
  invalidStatsToCsv,
  pruneInvalidTimestamps,
  savePersistedInvalidStats,
  loadPersistedInvalidStats,
  INVALID_STATS_WINDOW_MS,
  INVALID_STATS_MAX_ENTRIES,
  INVALID_STATS_STORAGE_KEY,
} from "../pwa-invalid-stats";

const NOW = 1_700_000_000_000;
const s = (secondsAgo: number) => NOW - secondsAgo * 1000;

describe("pwa-invalid-stats", () => {
  const timestamps = [
    s(30),         // 30s ago
    s(45),         // 45s ago
    s(90),         // 1m30s ago
    s(4 * 60),     // 4m
    s(10 * 60),    // 10m
    s(45 * 60),    // 45m
    s(2 * 3600),   // 2h
    s(23 * 3600),  // 23h
  ];

  it("countInWindow counts inclusive of boundary", () => {
    expect(countInWindow(timestamps, NOW, 60_000)).toBe(2); // 30s, 45s
    expect(countInWindow(timestamps, NOW, INVALID_STATS_WINDOW_MS["5m"])).toBe(4);
    expect(countInWindow(timestamps, NOW, INVALID_STATS_WINDOW_MS["1h"])).toBe(6);
    expect(countInWindow(timestamps, NOW, INVALID_STATS_WINDOW_MS["24h"])).toBe(8);
  });

  it("computeInvalidStats aggregates per selected window", () => {
    const stats = computeInvalidStats(timestamps, 8, NOW, "1h");
    expect(stats).toEqual({
      total: 8,
      lastMinute: 2,
      window: "1h",
      windowCount: 6,
      lastAt: timestamps[timestamps.length - 1],
    });
  });

  it("computeInvalidStats returns null lastAt when buffer is empty", () => {
    expect(computeInvalidStats([], 0, NOW, "5m").lastAt).toBeNull();
  });

  it("pruneInvalidTimestamps drops entries older than 24h retention", () => {
    const withOld = [...timestamps, s(25 * 3600), s(48 * 3600)];
    const pruned = pruneInvalidTimestamps(withOld, NOW);
    expect(pruned).toHaveLength(timestamps.length);
    expect(pruned.every((t) => t >= NOW - INVALID_STATS_WINDOW_MS["24h"])).toBe(true);
  });

  it("invalidStatsToCsv emits summary + per-event rows", () => {
    const stats = computeInvalidStats(timestamps, 8, NOW, "5m");
    const csv = invalidStatsToCsv(stats, timestamps, NOW);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("section,key,value");
    expect(lines).toContain("summary,total,8");
    expect(lines).toContain("summary,window,5m");
    expect(lines).toContain("summary,windowCount,4");
    // 1 header + 5 summary lines + blank + 1 event-header + N events
    const eventRows = lines.filter((l) => l.startsWith("event,") && !l.startsWith("event,index"));
    expect(eventRows).toHaveLength(timestamps.length);
  });
});
