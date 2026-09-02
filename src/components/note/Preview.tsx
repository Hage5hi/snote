import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import * as Y from "yjs";
import { expandWikiLinks } from "@/lib/wiki-link";
import { expandTranscludes } from "@/lib/wiki-transclude";
import { getSessionPlaintext, subscribeNoteIndex } from "@/lib/note-index";
import { renderMermaid } from "@/lib/markdown/renderers/mermaid";
import { renderKatex } from "@/lib/markdown/renderers/katex";
import { highlightCode } from "@/lib/markdown/renderers/highlight";
import { getCachedHtml, setCachedHtml } from "@/lib/markdown/render-cache";
import { renderInWorker, renderOnMainThread } from "@/lib/markdown/preview-worker-client";
import { handlePreviewChromeClick, labelPreviewChrome } from "@/lib/markdown/preview-chrome";
import { useI18n } from "@/i18n";

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

export function Preview({
  doc,
  className,
  slug,
}: {
  doc: Y.Doc;
  className?: string;
  slug?: string;
}) {
  const [html, setHtml] = useState("");
  const [lang, setLang] = useState("en");
  const lastTextLenRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const ridleRef = useRef<number | null>(null);
  const latestRenderIdRef = useRef(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { t } = useI18n();
  const emptyHtml = useMemo(
    () => `<p class="text-muted-foreground">${t("preview.empty").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</p>`,
    [t],
  );

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
      // Every render intent gets a generation, including cache hits. This is
      // what prevents an older worker miss from replacing newer cached HTML.
      const myRenderId = ++latestRenderIdRef.current;
      const isCurrent = () => !cancelled && myRenderId === latestRenderIdRef.current;
      const text = ytext.toString();
      if (Math.abs(text.length - lastTextLenRef.current) > 500 || lastTextLenRef.current === 0) {
        setLang(detectLang(text));
        lastTextLenRef.current = text.length;
      }
      // Transclude only when this preview belongs to a note slug. Share (and
      // any slug-less host) must not splice this tab's unlocked vault into a
      // foreign document. Failed tokens still become dead wiki links.
      const expanded = expandWikiLinks(
        expandTranscludes(
          text,
          { getPlaintext: slug ? getSessionPlaintext : () => null },
          { currentSlug: slug },
        ),
      );
      // Cache key is post-`expandWikiLinks` text (pre-hydration HTML).
      // Hydration (mermaid/katex/hljs + theme) re-runs in the next effect
      // regardless of cache hit, so theme toggles still apply.
      const cached = getCachedHtml(expanded);
      if (cached !== undefined) {
        if (isCurrent()) setHtml(cached);
        return;
      }
      let rendered: string;
      try {
        rendered = await renderInWorker(expanded);
      } catch {
        // Worker creation/runtime/postMessage failures discard the singleton.
        // If this intent is still relevant, render once on the main thread;
        // the next intent will retry a fresh worker through renderInWorker.
        if (!isCurrent()) return;
        try {
          rendered = await renderOnMainThread(expanded);
        } catch {
          return;
        }
      }
      if (!isCurrent()) return;
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
    const unsubIndex = subscribeNoteIndex(schedule);
    return () => {
      cancelled = true;
      cancel();
      ytext.unobserve(schedule);
      unsubIndex();
    };
  }, [doc, slug]);

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

    const mermaidEls = Array.from(host.querySelectorAll<HTMLElement>("[data-mermaid]"));
    const yieldIdle = () =>
      new Promise<void>((resolve) => {
        const w = window as unknown as {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        };
        if (w.requestIdleCallback) {
          w.requestIdleCallback(() => resolve(), { timeout: 200 });
        } else {
          setTimeout(resolve, 0);
        }
      });
    const hydrateOneMermaid = async (index: number): Promise<void> => {
      if (!isCurrent() || index >= mermaidEls.length) return;
      const el = mermaidEls[index];
      const code = decodeURIComponent(el.getAttribute("data-mermaid") || "");
      el.removeAttribute("data-mermaid");
      try {
        const svg = await renderMermaid(code, isDark);
        if (isCurrent()) {
          el.innerHTML = svg;
          el.classList.add("hydrate-fade-in");
        }
      } catch (e) {
        if (isCurrent()) {
          el.innerHTML = `<pre class="text-destructive text-sm">${escapeHtml(
            e instanceof Error ? e.message : String(e),
          )}</pre>`;
        }
      }
      if (!isCurrent()) return;
      await yieldIdle();
      await hydrateOneMermaid(index + 1);
    };
    void hydrateOneMermaid(0);

    const katexEls = host.querySelectorAll<HTMLElement>("[data-katex]");
    katexEls.forEach((el) => {
      const tex = decodeURIComponent(el.getAttribute("data-katex") || "");
      el.removeAttribute("data-katex");
      renderKatex(tex, true)
        .then((rendered) => {
          if (isCurrent()) {
            el.innerHTML = rendered;
            el.classList.add("hydrate-fade-in");
          }
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
          if (isCurrent()) {
            el.innerHTML = rendered;
            el.classList.add("hydrate-fade-in");
          }
        })
        .catch(() => {
          /* keep escaped text */
        });
    });

    labelPreviewChrome(host, t("preview.copy_code"), t("preview.heading_anchor"), {
      note: t("preview.alert.note"),
      tip: t("preview.alert.tip"),
      important: t("preview.alert.important"),
      warning: t("preview.alert.warning"),
      caution: t("preview.alert.caution"),
    });
  }, [html, isDark, t]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onClick = (event: MouseEvent) => {
      void handlePreviewChromeClick(event, host, {
        copy: t("preview.copy_code"),
        copied: t("preview.copied_code"),
      });
    };
    host.addEventListener("click", onClick);
    return () => host.removeEventListener("click", onClick);
  }, [t]);

  return (
    <div
      ref={hostRef}
      lang={lang}
      className={`markdown-preview prose prose-neutral dark:prose-invert max-w-none px-6 py-6 ${className ?? ""}`}
      dangerouslySetInnerHTML={{
        __html: html || emptyHtml,
      }}
    />
  );
}
