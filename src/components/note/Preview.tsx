import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { expandWikiLinks } from "@/lib/wiki-link";

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
      const purify = d.default;
      return {
        marked: (src: string) => m.marked.parse(src) as string,
        sanitize: (html: string) => purify.sanitize(html),
      };
    });
  }
  return markdownPromise;
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
      // Only re-detect language when the text length jumped enough to matter.
      if (Math.abs(text.length - lastTextLenRef.current) > 500 || lastTextLenRef.current === 0) {
        setLang(detectLang(text));
        lastTextLenRef.current = text.length;
      }
      if (!mod) return;
      const raw = mod.marked(expandWikiLinks(text));
      setHtml(mod.sanitize(raw));
    };

    const schedule = () => {
      cancel();
      // Coalesce keystrokes — render at most ~5 fps while typing fast,
      // and prefer idle callbacks so we don't compete with the editor.
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

  return (
    <div
      lang={lang}
      className={`markdown-preview prose prose-neutral dark:prose-invert max-w-none px-6 py-6 ${className ?? ""}`}
      dangerouslySetInnerHTML={{
        __html: html || '<p class="text-muted-foreground">Empty note. Bắt đầu gõ để xem preview.</p>',
      }}
    />
  );
}
