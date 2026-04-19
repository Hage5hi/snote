import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import * as Y from "yjs";

marked.setOptions({ gfm: true, breaks: true });

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

  useEffect(() => {
    const ytext = doc.getText("content");
    const render = () => {
      const text = ytext.toString();
      const raw = marked.parse(text) as string;
      setHtml(DOMPurify.sanitize(raw));
      setLang(detectLang(text));
    };
    render();
    ytext.observe(render);
    return () => ytext.unobserve(render);
  }, [doc]);

  return (
    <div
      lang={lang}
      className={`markdown-preview prose prose-neutral dark:prose-invert max-w-none px-6 py-6 ${className ?? ""}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html || '<p class="text-muted-foreground">Empty note. Bắt đầu gõ để xem preview.</p>' }}
    />
  );
}
