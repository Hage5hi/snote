import { describe, it, expect } from "vitest";
import { normalizeSnapshotKind, filterSnapshots, type Snapshot } from "@/lib/snapshots";

describe("normalizeSnapshotKind", () => {
  it("passes through valid kinds", () => {
    expect(normalizeSnapshotKind("periodic")).toBe("periodic");
    expect(normalizeSnapshotKind("sudden_delete")).toBe("sudden_delete");
  });

  it("returns 'periodic' for missing kind (legacy rows)", () => {
    expect(normalizeSnapshotKind(undefined)).toBe("periodic");
    expect(normalizeSnapshotKind(null)).toBe("periodic");
  });

  it("returns 'periodic' for invalid/garbage values", () => {
    expect(normalizeSnapshotKind("garbage")).toBe("periodic");
    expect(normalizeSnapshotKind("")).toBe("periodic");
    expect(normalizeSnapshotKind(42)).toBe("periodic");
    expect(normalizeSnapshotKind({})).toBe("periodic");
  });
});

describe("filterSnapshots resilience to bad kind data", () => {
  const NOW = 1_700_000_000_000;
  const items = [
    { id: 1, slug: "a", ts: NOW, charCount: 0, preview: "", content: "", kind: "garbage" as unknown },
    { id: 2, slug: "a", ts: NOW, charCount: 0, preview: "", content: "" }, // legacy, no kind
    { id: 3, slug: "a", ts: NOW, charCount: 0, preview: "", content: "", kind: "sudden_delete" as const },
  ] as Snapshot[];

  it("treats garbage and missing kind identically as 'periodic'", () => {
    expect(filterSnapshots(items, { now: NOW, kind: "periodic" }).map((s) => s.id)).toEqual([1, 2]);
    expect(filterSnapshots(items, { now: NOW, kind: "sudden_delete" }).map((s) => s.id)).toEqual([3]);
  });
});
