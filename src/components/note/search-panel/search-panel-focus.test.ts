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

function ruleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  return [...css.matchAll(re)].map((match) => match[1]);
}

describe("search panel focus chrome", () => {
  it("does not paint a saturated primary/accent bottom bar on focused Find/Replace inputs", () => {
    const css = overlayCss();
    const focusBodies = [
      ...ruleBodies(css, ".snote-search-panel input:focus"),
      ...ruleBodies(css, ".snote-search-panel input:focus-visible"),
      ...ruleBodies(css, ".snote-search-field:focus"),
      ...ruleBodies(css, ".snote-search-field:focus-visible"),
    ];
    expect(focusBodies.length).toBeGreaterThan(0);
    const joined = focusBodies.join("\n");
    expect(joined).not.toMatch(/border-bottom(?:-color)?:\s*[^;]*--primary/);
    expect(joined).not.toMatch(/border-bottom(?:-color)?:\s*[^;]*accent/);
    expect(css).not.toMatch(/input:focus\s*\{\s*border-bottom(?:-color)?:\s*[^}]*--primary/);
  });

  it("keeps a low-contrast token focus (border or ring), not a 2px bottom accent", () => {
    const css = overlayCss();
    const inputBody = ruleBodies(css, ".snote-search-panel input").join("\n");
    expect(inputBody).not.toMatch(/border-bottom:\s*2px/);
    const focusBodies = [
      ...ruleBodies(css, ".snote-search-panel input:focus"),
      ...ruleBodies(css, ".snote-search-panel input:focus-visible"),
    ].join("\n");
    expect(focusBodies).toMatch(/border-color:\s*hsl\(var\(--(?:border|input)\)|box-shadow:/);
    expect(focusBodies).not.toMatch(/border-bottom-color:/);
  });
});
