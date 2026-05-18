import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetMermaidForTests, renderMermaid } from "../mermaid";
import { __resetMermaidCacheForTests } from "../mermaid-cache";

describe("renderMermaid (lazy singleton)", () => {
  afterEach(() => {
    vi.resetModules();
    __resetMermaidForTests();
    __resetMermaidCacheForTests();
  });

  it("imports the mermaid module exactly once across multiple invocations", async () => {
    const initialize = vi.fn();
    const render = vi.fn(async (id: string) => ({ svg: `<svg id="${id}">x</svg>` }));
    let importCount = 0;

    vi.doMock("mermaid", () => {
      importCount += 1;
      return { default: { initialize, render } };
    });

    // Re-import target so the mock takes effect.
    const { renderMermaid: lazy, __resetMermaidForTests: reset } = await import("../mermaid");
    reset();

    const svg1 = await lazy("graph TD;A-->B;", false);
    const svg2 = await lazy("graph TD;C-->D;", true);
    const svg3 = await lazy("graph TD;E-->F;", false);

    expect(svg1).toContain("<svg");
    expect(svg2).toContain("<svg");
    expect(svg3).toContain("<svg");
    // Module factory invoked exactly once even though we called the
    // renderer three times — singleton promise prevents reload thrash.
    expect(importCount).toBe(1);
    // initialize is called per-render (cheap) so theme switches take effect;
    // render is called once per invocation.
    expect(render).toHaveBeenCalledTimes(3);

    // Use the imported `renderMermaid` to satisfy the import-binding lint.
    expect(typeof renderMermaid).toBe("function");
  });

  it("caches SVG output: same code+theme calls mermaid.render only once", async () => {
    const initialize = vi.fn();
    const render = vi.fn(async (id: string) => ({ svg: `<svg id="${id}">cached</svg>` }));

    vi.doMock("mermaid", () => ({ default: { initialize, render } }));

    const { renderMermaid: lazy, __resetMermaidForTests: reset } = await import("../mermaid");
    const { __resetMermaidCacheForTests: resetCache } = await import("../mermaid-cache");
    reset();
    resetCache();

    const svg1 = await lazy("graph TD;A-->B;", false);
    const svg2 = await lazy("graph TD;A-->B;", false);

    expect(svg1).toBe(svg2);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
