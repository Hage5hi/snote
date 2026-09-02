import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  BURST_GAP_MS,
  LIVE_TEXT_MISMATCH,
  applySelectedHunks,
  applySelectedHunksToYText,
  clusterSnapshots,
  diffHunks,
  type BurstSnapshot,
} from "@/lib/snapshot-history";

const MIN = 60_000;
const NOW = 1_700_000_000_000;

function snap(
  ts: number,
  content: string,
  extra: Partial<BurstSnapshot> = {},
): BurstSnapshot {
  return { ts, content, kind: "periodic", ...extra };
}

describe("clusterSnapshots", () => {
  it("returns an empty list when there are no snapshots", () => {
    expect(clusterSnapshots([])).toEqual([]);
  });

  it("clusters snapshots whose timestamps are within the burst gap", () => {
    const items = [
      snap(NOW - 40 * MIN, "oldest", { id: 3, kind: "periodic" }),
      snap(NOW - 5 * MIN, "newest", { id: 1, kind: "sudden_delete" }),
      snap(NOW - 12 * MIN, "mid", { id: 2, kind: "periodic" }),
    ];
    const bursts = clusterSnapshots(items);
    expect(BURST_GAP_MS).toBe(15 * MIN);
    expect(bursts).toHaveLength(2);
    expect(bursts[0].snapshots.map((s) => s.id)).toEqual([2, 1]);
    expect(bursts[0].fromContent).toBe("mid");
    expect(bursts[0].toContent).toBe("newest");
    expect(bursts[0].vsCurrent).toBe(false);
    expect(bursts[1].snapshots.map((s) => s.id)).toEqual([3]);
    expect(bursts[1].fromContent).toBe("oldest");
    expect(bursts[1].toContent).toBe("oldest");
  });

  it("keeps 10-minute periodic snapshots in one burst", () => {
    const items = [
      snap(NOW - 20 * MIN, "a", { id: 1 }),
      snap(NOW - 10 * MIN, "b", { id: 2 }),
    ];
    expect(clusterSnapshots(items)).toHaveLength(1);
  });

  it("extends the newest burst to current when current is nearby", () => {
    const items = [
      snap(NOW - 8 * MIN, "snap", { id: 1 }),
    ];
    const bursts = clusterSnapshots(items, {
      current: { ts: NOW, content: "live" },
    });
    expect(bursts).toHaveLength(1);
    expect(bursts[0].fromContent).toBe("snap");
    expect(bursts[0].toContent).toBe("live");
    expect(bursts[0].vsCurrent).toBe(true);
  });

  it("adds a snapshot-vs-current burst when the latest snapshot is far from now", () => {
    const items = [
      snap(NOW - 40 * MIN, "old", { id: 1 }),
    ];
    const bursts = clusterSnapshots(items, {
      current: { ts: NOW, content: "live" },
    });
    expect(bursts).toHaveLength(2);
    expect(bursts[0].vsCurrent).toBe(true);
    expect(bursts[0].fromContent).toBe("old");
    expect(bursts[0].toContent).toBe("live");
    expect(bursts[0].snapshots.map((s) => s.id)).toEqual([1]);
    expect(bursts[1].vsCurrent).toBe(false);
    expect(bursts[1].toContent).toBe("old");
  });

  it("does not duplicate snapshot rows when distant current is omitted", () => {
    const items = [snap(NOW - 40 * MIN, "old", { id: 1 })];
    const bursts = clusterSnapshots(items, {
      current: { ts: NOW, content: "live" },
      includeDistantCurrent: false,
    });
    expect(bursts).toHaveLength(1);
    expect(bursts[0].vsCurrent).toBe(false);
    expect(bursts[0].snapshots).toHaveLength(1);
  });
});

const CONTEXT_PAD = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];

describe("diffHunks + applySelectedHunks", () => {
  it("groups a deleted paragraph as one hunk and restores it", () => {
    const oldText = ["title", "keep me", "gone paragraph", "tail"].join("\n");
    const newText = ["title", "keep me", "tail"].join("\n");
    const hunks = diffHunks(oldText, newText);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.some((l) => l.type === "remove" && l.text === "gone paragraph")).toBe(true);
    expect(applySelectedHunks(oldText, newText, hunks, [hunks[0].id])).toBe(oldText);
  });

  it("applies only the selected hunk and leaves the other change", () => {
    const oldText = ["A-old", ...CONTEXT_PAD, "B-old"].join("\n");
    const newText = ["A-new", ...CONTEXT_PAD, "B-new"].join("\n");
    const hunks = diffHunks(oldText, newText);
    expect(hunks).toHaveLength(2);
    const first = hunks.find((h) => h.lines.some((l) => l.text === "A-old"))!;
    const result = applySelectedHunks(oldText, newText, hunks, [first.id]);
    expect(result).toBe(["A-old", ...CONTEXT_PAD, "B-new"].join("\n"));
  });

  it("applies several selected hunks onto a Y.Text in a single transact", () => {
    const oldText = ["A-old", ...CONTEXT_PAD, "B-old"].join("\n");
    const newText = ["A-new", ...CONTEXT_PAD, "B-new"].join("\n");
    const hunks = diffHunks(oldText, newText);
    expect(hunks).toHaveLength(2);

    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, newText);

    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });

    applySelectedHunksToYText(doc, {
      oldText,
      newText,
      hunks,
      selectedIds: hunks.map((h) => h.id),
    });

    expect(transactions).toBe(1);
    expect(ytext.toString()).toBe(oldText);
  });

  it("refuses to apply hunks when live Y.Text no longer matches the diffed new text", () => {
    const oldText = "alpha\nbeta";
    const newText = "alpha\ngamma";
    const hunks = diffHunks(oldText, newText);
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, "drifted");
    expect(() =>
      applySelectedHunksToYText(doc, {
        oldText,
        newText,
        hunks,
        selectedIds: hunks.map((h) => h.id),
      }),
    ).toThrow(LIVE_TEXT_MISMATCH);
    expect(ytext.toString()).toBe("drifted");
  });

  it("is a no-op when nothing is selected", () => {
    const oldText = "alpha\nbeta";
    const newText = "alpha\ngamma";
    const hunks = diffHunks(oldText, newText);
    expect(hunks.length).toBeGreaterThan(0);
    expect(applySelectedHunks(oldText, newText, hunks, [])).toBe(newText);
  });
});
