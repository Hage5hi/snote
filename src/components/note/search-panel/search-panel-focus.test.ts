import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const INDEX_CSS = resolve(__dirname, "../../../index.css");

function overlayCss(): string {
  const css = readFileSync(INDEX_CSS, "utf8");
  const start = css.indexOf("/* ================== In-note find/replace overlay");
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start);
}

/** Collect rule bodies whose selector list includes `needle` (grouped selectors OK). */
function declarationsFor(css: string, needle: string): string[] {
  const bodies: string[] = [];
  const re = /([^{}@][^{]*)\{([^}]*)\}/g;
  for (const match of css.matchAll(re)) {
    const selectors = match[1].split(",").map((part) => part.trim().replace(/\s+/g, " "));
    if (selectors.some((selector) => selector === needle || selector.endsWith(" " + needle))) {
      bodies.push(match[2]);
    }
  }
  return bodies;
}

describe("search panel focus chrome", () => {
  it("does not paint a saturated primary/accent bottom bar on focused Find/Replace inputs", () => {
    const css = overlayCss();
    expect(css).not.toContain("border-bottom-color: hsl(var(--primary))");
    expect(css).not.toMatch(/input:focus[^{]*\{[^}]*border-bottom(?:-color)?:\s*[^;]*(?:--primary|accent)/);

    const focusBodies = [
      ...declarationsFor(css, ".snote-search-panel input:focus"),
      ...declarationsFor(css, ".snote-search-panel input:focus-visible"),
    ];
    expect(focusBodies.length).toBeGreaterThan(0);
    const joined = focusBodies.join("\n");
    expect(joined).not.toMatch(/border-bottom(?:-color)?:/);
    expect(joined).not.toMatch(/--primary/);
  });

  it("keeps a low-contrast token focus (border or ring), not a 2px bottom accent", () => {
    const css = overlayCss();
    const inputBody = declarationsFor(css, ".snote-search-panel input").join("\n");
    expect(inputBody).not.toMatch(/border-bottom:\s*2px/);
    const focusBodies = [
      ...declarationsFor(css, ".snote-search-panel input:focus"),
      ...declarationsFor(css, ".snote-search-panel input:focus-visible"),
    ].join("\n");
    expect(focusBodies.length).toBeGreaterThan(0);
    expect(focusBodies).toMatch(/border-color:\s*hsl\(var\(--(?:border|input)\)|box-shadow:/);
    expect(focusBodies).not.toMatch(/border-bottom-color:/);
  });
});
