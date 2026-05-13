import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import * as Y from "yjs";
import { expandWikiLinks } from "@/lib/wiki-link";
import { renderMermaid } from "@/lib/markdown/renderers/mermaid";
import { renderKatex } from "@/lib/markdown/renderers/katex";
import { highlightCode } from "@/lib/markdown/renderers/highlight";
import { getCachedHtml, setCachedHtml } from "@/lib/markdown/render-cache";

// `marked` + `dompurify` are loaded lazily on first render so the
// editor-only path never pulls them. Result is a smaller initial chunk and
// faster open of any note where the user hasn't toggled preview yet.
type MarkedFn = (src: string) => string;
type SanitizeFn = (html: string) => string;

let markdownPromise: Promise<{ marked: MarkedFn; sanitize: SanitizeFn }> | null = null;
function loadMarkdown() {
  if (!markdownPromise) {
    markdownPromise = Promise.all([import("marked"), import("dompurify")]).then(([m, d]) => {
      m.marked.setOptions({ gfm: true, breaks: true });
      // Custom code renderer:
      //   ```mermaid → placeholder hydrated into SVG (lazy mermaid chunk)
      //   ```math / ```katex → placeholder hydrated into KaTeX HTML
      //   any other lang → placeholder for syntax highlighting
      // Placeholders survive DOMPurify because they're plain divs/pres
      // with `data-*` attributes carrying URI-encoded source.
      m.marked.use({
        renderer: {
          code({ lang, text }: { lang?: string; text: string }) {
            const enc = encodeURIComponent(text);
            const l = (lang || "").trim().toLowerCase();
            if (l === "mermaid") {
              return `<div class="mermaid-block my-3" data-mermaid="${enc}"><div class="text-muted-foreground text-sm">Đang tải biểu đồ…</div></div>`;
            }
            if (l === "math" || l === "katex") {
              return `<div class="katex-block my-3" data-katex="${enc}"><div class="text-muted-foreground text-sm">Đang tải công thức…</div></div>`;
            }
            const safeLang = /^[a-z0-9+#-]{1,20}$/.test(l) ? l : "";
            return `<pre><code class="hljs language-${safeLang}" data-hljs-lang="${safeLang}" data-hljs-code="${enc}">${escapeHtml(text)}</code></pre>`;
          },
        },
      });
      const purify = d.default;
      // Allow our placeholder data-* attributes through DOMPurify.
      const ADD_ATTR = ["data-mermaid", "data-katex", "data-hljs-lang", "data-hljs-code"];
      return {
        marked: (src: string) => m.marked.parse(src) as string,
        sanitize: (html: string) => purify.sanitize(html, { ADD_ATTR }),
      };
    });
  }
  return markdownPromise;
}

function escapeHtml(s: string) {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

const RE_HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
const RE_HIRAGANA_KATAKANA = /[\u3040-\u30ff]/g;
const RE_HANGUL = /[\uac00-\ud7af]/g;
function detectLang(text: string): string {
  if (!text) return "en";
  const sample = text.slice(0, 2000);
  const han = (sample.match(RE_HAN) || []).length;
  const kana = (sample.match(RE_HIRAGANA_KATAKANA) || []).length;
  const hangul = (sample.match(RE_HANGUL) || []).length;
  if (kana > 5 || (kana > 0 && kana >= han / 2)) return "ja";
  if (hangul > 5) return "ko";
  if (han > 5) return "zh";
  return "en";
}

export function Preview({ doc, className }: { doc: Y.Doc; className?: string }) {
  const [html, setHtml] = useState("");
  const [lang, setLang] = useState("en");
  const lastTextLenRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const ridleRef = useRef<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const ytext = doc.getText("content");
    let cancelled = false;
    let mod: { marked: MarkedFn; sanitize: SanitizeFn } | null = null;

    const cancel = () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (ridleRef.current) {
        const w = window as unknown as { cancelIdleCallback?: (id: number) => void };
        w.cancelIdleCallback?.(ridleRef.current);
        ridleRef.current = null;
      }
    };

    const doRender = () => {
      const text = ytext.toString();
      if (Math.abs(text.length - lastTextLenRef.current) > 500 || lastTextLenRef.current === 0) {
        setLang(detectLang(text));
        lastTextLenRef.current = text.length;
      }
      if (!mod) return;
      const expanded = expandWikiLinks(text);
      // Cache key is post-`expandWikiLinks` text (pre-hydration HTML).
      // Hydration (mermaid/katex/hljs + theme) re-runs in the next effect
      // regardless of cache hit, so theme toggles still apply.
      const cached = getCachedHtml(expanded);
      if (cached !== undefined) {
        setHtml(cached);
        return;
      }
      const sanitized = mod.sanitize(mod.marked(expanded));
      setCachedHtml(expanded, sanitized);
      setHtml(sanitized);
    };

    const schedule = () => {
      cancel();
      debounceRef.current = window.setTimeout(() => {
        const w = window as unknown as {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        };
        if (w.requestIdleCallback) {
          ridleRef.current = w.requestIdleCallback(doRender, { timeout: 400 });
        } else {
          doRender();
        }
      }, 160);
    };

    void loadMarkdown().then((m) => {
      if (cancelled) return;
      mod = m;
      doRender();
    });

    ytext.observe(schedule);
    return () => {
      cancelled = true;
      cancel();
      ytext.unobserve(schedule);
    };
  }, [doc]);

  // Hydrate placeholders left by the custom code renderer. Each effect run
  // tags itself with a token; async work checks the token before writing
  // back to the DOM so a later re-render (or theme switch) doesn't get
  // overwritten by a stale chunk.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !html) return;
    const token = Symbol("hydrate");
    (host as unknown as { __hydrationToken?: symbol }).__hydrationToken = token;
    const isCurrent = () =>
      (host as unknown as { __hydrationToken?: symbol }).__hydrationToken === token;

    const mermaidEls = host.querySelectorAll<HTMLElement>("[data-mermaid]");
    mermaidEls.forEach((el) => {
      const code = decodeURIComponent(el.getAttribute("data-mermaid") || "");
      el.removeAttribute("data-mermaid");
      renderMermaid(code, isDark)
        .then((svg) => {
          if (isCurrent()) el.innerHTML = svg;
        })
        .catch((e) => {
          if (isCurrent()) {
            el.innerHTML = `<pre class="text-destructive text-sm">${escapeHtml(
              e instanceof Error ? e.message : String(e),
            )}</pre>`;
          }
        });
    });

    const katexEls = host.querySelectorAll<HTMLElement>("[data-katex]");
    katexEls.forEach((el) => {
      const tex = decodeURIComponent(el.getAttribute("data-katex") || "");
      el.removeAttribute("data-katex");
      renderKatex(tex, true)
        .then((rendered) => {
          if (isCurrent()) el.innerHTML = rendered;
        })
        .catch((e) => {
          if (isCurrent()) {
            el.innerHTML = `<span class="katex-error">${escapeHtml(
              e instanceof Error ? e.message : String(e),
            )}</span>`;
          }
        });
    });

    const codeEls = host.querySelectorAll<HTMLElement>("[data-hljs-code]");
    codeEls.forEach((el) => {
      const code = decodeURIComponent(el.getAttribute("data-hljs-code") || "");
      const lang = el.getAttribute("data-hljs-lang") || "";
      el.removeAttribute("data-hljs-code");
      if (!lang) return; // no language → leave plain escaped text
      highlightCode(code, lang)
        .then((rendered) => {
          if (isCurrent()) el.innerHTML = rendered;
        })
        .catch(() => {
          /* keep escaped text */
        });
    });
  }, [html, isDark]);

  return (
    <div
      ref={hostRef}
      lang={lang}
      className={`markdown-preview prose prose-neutral dark:prose-invert max-w-none px-6 py-6 ${className ?? ""}`}
      dangerouslySetInnerHTML={{
        __html: html || '<p class="text-muted-foreground">Empty note. Bắt đầu gõ để xem preview.</p>',
      }}
    />
  );
}
