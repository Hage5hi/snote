import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import * as Y from "yjs";
import { expandWikiLinks } from "@/lib/wiki-link";
import { renderMermaid } from "@/lib/markdown/renderers/mermaid";
import { renderKatex } from "@/lib/markdown/renderers/katex";
import { highlightCode } from "@/lib/markdown/renderers/highlight";
import { getCachedHtml, setCachedHtml } from "@/lib/markdown/render-cache";
import { renderInWorker } from "@/lib/markdown/preview-worker-client";

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
  const latestRenderIdRef = useRef(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const ytext = doc.getText("content");
    let cancelled = false;

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

    const doRender = async () => {
      const text = ytext.toString();
      if (Math.abs(text.length - lastTextLenRef.current) > 500 || lastTextLenRef.current === 0) {
        setLang(detectLang(text));
        lastTextLenRef.current = text.length;
      }
      const expanded = expandWikiLinks(text);
      // Cache key is post-`expandWikiLinks` text (pre-hydration HTML).
      // Hydration (mermaid/katex/hljs + theme) re-runs in the next effect
      // regardless of cache hit, so theme toggles still apply.
      const cached = getCachedHtml(expanded);
      if (cached !== undefined) {
        setHtml(cached);
        return;
      }
      // Stale-guard: capture render id before await, drop response if a
      // newer doRender has started in the meantime.
      const myRenderId = ++latestRenderIdRef.current;
      const rendered = await renderInWorker(expanded);
      if (cancelled || myRenderId !== latestRenderIdRef.current) return;
      setCachedHtml(expanded, rendered);
      setHtml(rendered);
    };

    const schedule = () => {
      cancel();
      debounceRef.current = window.setTimeout(() => {
        const w = window as unknown as {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        };
        if (w.requestIdleCallback) {
          ridleRef.current = w.requestIdleCallback(() => void doRender(), { timeout: 400 });
        } else {
          void doRender();
        }
      }, 160);
    };

    void doRender();
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
      if (!lang) return;
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
