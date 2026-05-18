import { describe, it, expect, beforeEach } from "vitest";
import {
  getCachedMermaid,
  setCachedMermaid,
  __resetMermaidCacheForTests,
} from "../mermaid-cache";

describe("mermaid-cache", () => {
  beforeEach(() => __resetMermaidCacheForTests());

  it("miss returns undefined, hit returns stored svg", () => {
    expect(getCachedMermaid("graph TD;A-->B;", "light")).toBeUndefined();
    setCachedMermaid("graph TD;A-->B;", "light", "<svg>x</svg>");
    expect(getCachedMermaid("graph TD;A-->B;", "light")).toBe("<svg>x</svg>");
  });

  it("separates entries by theme for same code", () => {
    setCachedMermaid("graph TD;A-->B;", "light", "<svg>light</svg>");
    setCachedMermaid("graph TD;A-->B;", "dark", "<svg>dark</svg>");
    expect(getCachedMermaid("graph TD;A-->B;", "light")).toBe("<svg>light</svg>");
    expect(getCachedMermaid("graph TD;A-->B;", "dark")).toBe("<svg>dark</svg>");
  });

  it("evicts oldest when exceeding 30 entries", () => {
    for (let i = 0; i < 30; i++) setCachedMermaid(`code${i}`, "light", `svg${i}`);
    expect(getCachedMermaid("code0", "light")).toBe("svg0");
    // 31st insertion evicts LRU (code1 — code0 was just touched).
    setCachedMermaid("code30", "light", "svg30");
    expect(getCachedMermaid("code1", "light")).toBeUndefined();
    expect(getCachedMermaid("code0", "light")).toBe("svg0");
    expect(getCachedMermaid("code30", "light")).toBe("svg30");
  });
});
