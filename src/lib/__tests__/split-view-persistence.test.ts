import { describe, it, expect, beforeEach } from "vitest";
import {
  saveLastSplitView,
  loadLastSplitView,
  clearLastSplitView,
  LAST_SPLIT_VIEW_STORAGE_KEY,
} from "../split-view-persistence";

describe("split-view-persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("round-trips a 2-slug layout", () => {
    saveLastSplitView(["a", "b"]);
    const got = loadLastSplitView();
    expect(got?.count).toBe(2);
    expect(got?.path).toBe("/a+b");
    expect(got?.slugs).toEqual(["a", "b"]);
  });

  it("round-trips 3 and 4 slugs", () => {
    saveLastSplitView(["a", "b", "c"]);
    expect(loadLastSplitView()?.path).toBe("/a+b+c");
    saveLastSplitView(["a", "b", "c", "d"]);
    expect(loadLastSplitView()?.count).toBe(4);
  });

  it("ignores counts outside 2..4", () => {
    saveLastSplitView(["only"]);
    expect(loadLastSplitView()).toBeNull();
    saveLastSplitView(["a", "b", "c", "d", "e"]);
    expect(loadLastSplitView()).toBeNull();
  });

  it("clears storage", () => {
    saveLastSplitView(["a", "b"]);
    clearLastSplitView();
    expect(window.sessionStorage.getItem(LAST_SPLIT_VIEW_STORAGE_KEY)).toBeNull();
    expect(loadLastSplitView()).toBeNull();
  });

  it("returns null on malformed json", () => {
    window.sessionStorage.setItem(LAST_SPLIT_VIEW_STORAGE_KEY, "{not json");
    expect(loadLastSplitView()).toBeNull();
  });

  it("returns null when stored slugs count is invalid", () => {
    window.sessionStorage.setItem(
      LAST_SPLIT_VIEW_STORAGE_KEY,
      JSON.stringify({ path: "/a", slugs: ["a"], count: 1, savedAt: 0 }),
    );
    expect(loadLastSplitView()).toBeNull();
  });
});
