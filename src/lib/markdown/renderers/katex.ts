// Lazy-loaded KaTeX renderer. Both the JS (~250KB) and CSS (~30KB) load on
// first math block. Vite emits `katex/dist/katex.min.css` as its own CSS
// chunk because it's referenced via `import()`.
type Katex = typeof import("katex").default;

let katexPromise: Promise<Katex> | null = null;
let cssInjected = false;

async function loadKatex(): Promise<Katex> {
  if (!katexPromise) {
    katexPromise = import("katex").then((m) => m.default);
    if (!cssInjected) {
      cssInjected = true;
      // Side-effect import — Vite tracks this and ships the stylesheet as
      // a separate chunk so the editor-only path never pays for it.
      void import("katex/dist/katex.min.css");
    }
  }
  return katexPromise;
}

export async function renderKatex(tex: string, displayMode: boolean): Promise<string> {
  const katex = await loadKatex();
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: "warn",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `<span class="katex-error" title="${escapeAttr(msg)}">${escapeHtml(tex)}</span>`;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}
function escapeAttr(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

export function __resetKatexForTests() {
  katexPromise = null;
  cssInjected = false;
}
