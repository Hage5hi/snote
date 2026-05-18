// Lazy-loaded Mermaid renderer. The `mermaid` package (~576KB) is pulled
// only when the user actually views a note containing a ```mermaid block.
// Singleton promise — repeat invocations reuse the same module instance.
import { getCachedMermaid, setCachedMermaid } from "./mermaid-cache";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

async function loadMermaid(themeIsDark: boolean) {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: themeIsDark ? "dark" : "default",
        // CRITICAL: keep "strict" — mermaid otherwise allows arbitrary HTML
        // inside diagram labels which is XSS through user-supplied content.
        securityLevel: "strict",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export async function renderMermaid(code: string, themeIsDark: boolean): Promise<string> {
  const theme = themeIsDark ? "dark" : "light";
  const cached = getCachedMermaid(code, theme);
  if (cached !== undefined) return cached;
  const mermaid = await loadMermaid(themeIsDark);
  // Re-apply theme on subsequent renders (initialize only ran once).
  mermaid.initialize({
    startOnLoad: false,
    theme: themeIsDark ? "dark" : "default",
    securityLevel: "strict",
  });
  const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
  const { svg } = await mermaid.render(id, code);
  setCachedMermaid(code, theme, svg);
  return svg;
}

// Test-only: reset singleton between unit tests.
export function __resetMermaidForTests() {
  mermaidPromise = null;
}
