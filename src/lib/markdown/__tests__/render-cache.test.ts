import { describe, it, expect, beforeEach } from "vitest";
import {
  getCachedHtml,
  setCachedHtml,
  __resetRenderCacheForTests,
} from "../render-cache";

describe("render-cache", () => {
  beforeEach(() => __resetRenderCacheForTests());

  it("miss returns undefined, hit returns stored html", () => {
    expect(getCachedHtml("foo")).toBeUndefined();
    setCachedHtml("foo", "<p>foo</p>");
    expect(getCachedHtml("foo")).toBe("<p>foo</p>");
  });

  it("evicts oldest when exceeding 50 entries", () => {
    for (let i = 0; i < 50; i++) setCachedHtml(`k${i}`, `v${i}`);
    expect(getCachedHtml("k0")).toBe("v0");
    // 51st entry triggers eviction of the LRU (now k1, since k0 was just touched).
    setCachedHtml("k50", "v50");
    expect(getCachedHtml("k1")).toBeUndefined();
    expect(getCachedHtml("k0")).toBe("v0");
    expect(getCachedHtml("k50")).toBe("v50");
  });

  it("LRU touch on get prevents eviction of recently-read entry", () => {
    for (let i = 0; i < 50; i++) setCachedHtml(`k${i}`, `v${i}`);
    // Touch k0 so it becomes most-recent.
    getCachedHtml("k0");
    // Insert one more → oldest is now k1, not k0.
    setCachedHtml("new", "v");
    expect(getCachedHtml("k0")).toBe("v0");
    expect(getCachedHtml("k1")).toBeUndefined();
  });
});
