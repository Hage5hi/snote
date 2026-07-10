import { describe, it, expect } from "vitest";
import { filterSnapshots, type Snapshot } from "@/lib/snapshots";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

const items: Snapshot[] = [
  { id: 1, slug: "a", ts: NOW - 5 * MIN, charCount: 10, preview: "recent periodic", content: "x", kind: "periodic" },
  { id: 2, slug: "a", ts: NOW - 2 * H, charCount: 20, preview: "recent sudden", content: "y", kind: "sudden_delete" },
  { id: 3, slug: "a", ts: NOW - 3 * D, charCount: 30, preview: "3-day-old periodic", content: "z", kind: "periodic" },
  // Legacy row without `kind` — must be treated as "periodic".
  { id: 4, slug: "a", ts: NOW - 10 * D, charCount: 40, preview: "legacy", content: "w" },
];

describe("filterSnapshots", () => {
  it("returns everything with no filters", () => {
    expect(filterSnapshots(items, { now: NOW }).map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });

  it("filters by time range", () => {
    expect(
      filterSnapshots(items, { now: NOW, rangeMs: D }).map((s) => s.id),
    ).toEqual([1, 2]);
  });

  it("filters by kind=sudden_delete", () => {
    expect(
      filterSnapshots(items, { now: NOW, kind: "sudden_delete" }).map((s) => s.id),
    ).toEqual([2]);
  });

  it("treats missing kind as 'periodic'", () => {
    expect(
      filterSnapshots(items, { now: NOW, kind: "periodic" }).map((s) => s.id),
    ).toEqual([1, 3, 4]);
  });

  it("combines range + kind", () => {
    expect(
      filterSnapshots(items, { now: NOW, rangeMs: D, kind: "periodic" }).map((s) => s.id),
    ).toEqual([1]);
    expect(
      filterSnapshots(items, { now: NOW, rangeMs: D, kind: "sudden_delete" }).map((s) => s.id),
    ).toEqual([2]);
  });

  it("kind='all' is equivalent to no kind filter", () => {
    expect(
      filterSnapshots(items, { now: NOW, kind: "all" }).map((s) => s.id),
    ).toEqual(filterSnapshots(items, { now: NOW }).map((s) => s.id));
  });
});
