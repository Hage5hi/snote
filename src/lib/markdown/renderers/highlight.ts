// Lazy-loaded syntax highlighter. We pull `highlight.js/lib/core` (~20KB)
// instead of the full bundle (~200KB) and register only the languages we
// actually encounter, on demand. Each language ends up in its own tiny
// chunk per the manualChunks rule for `/highlight.js/`.
import type HLJSAPI from "highlight.js";

type HLJS = typeof HLJSAPI;

let hljsPromise: Promise<HLJS> | null = null;
const loadedLanguages = new Set<string>();
const loadingLanguages = new Map<string, Promise<void>>();

const LANG_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  js: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  ts: () => import("highlight.js/lib/languages/typescript"),
  jsx: () => import("highlight.js/lib/languages/javascript"),
  tsx: () => import("highlight.js/lib/languages/typescript"),
  python: () => import("highlight.js/lib/languages/python"),
  py: () => import("highlight.js/lib/languages/python"),
  bash: () => import("highlight.js/lib/languages/bash"),
  sh: () => import("highlight.js/lib/languages/bash"),
  shell: () => import("highlight.js/lib/languages/bash"),
  json: () => import("highlight.js/lib/languages/json"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  yml: () => import("highlight.js/lib/languages/yaml"),
  rust: () => import("highlight.js/lib/languages/rust"),
  go: () => import("highlight.js/lib/languages/go"),
  java: () => import("highlight.js/lib/languages/java"),
  css: () => import("highlight.js/lib/languages/css"),
  html: () => import("highlight.js/lib/languages/xml"),
  xml: () => import("highlight.js/lib/languages/xml"),
  sql: () => import("highlight.js/lib/languages/sql"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  md: () => import("highlight.js/lib/languages/markdown"),
};

async function loadHljs(): Promise<HLJS> {
  if (!hljsPromise) {
    hljsPromise = import("highlight.js/lib/core").then((m) => m.default as unknown as HLJS);
    void import("highlight.js/styles/github-dark.css");
  }
  return hljsPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  const hljs = await loadHljs();
  const key = (lang || "").toLowerCase();
  if (key && LANG_LOADERS[key] && !loadedLanguages.has(key)) {
    let p = loadingLanguages.get(key);
    if (!p) {
      p = LANG_LOADERS[key]().then((mod) => {
        // registerLanguage is idempotent for same name; safe under races.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hljs.registerLanguage(key, mod.default as any);
        loadedLanguages.add(key);
      });
      loadingLanguages.set(key, p);
    }
    await p;
  }
  try {
    const lookup = hljs.getLanguage(key) ? key : "plaintext";
    return hljs.highlight(code, { language: lookup }).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

export function __resetHighlightForTests() {
  hljsPromise = null;
  loadedLanguages.clear();
  loadingLanguages.clear();
}
