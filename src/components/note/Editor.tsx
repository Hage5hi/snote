import { useEffect, useRef, useState } from "react";

// Detect dominant CJK script in text so we can set the right `lang` attribute
// for word-break and font-fallback rules.
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
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

interface EditorProps {
  doc: Y.Doc;
  awareness: Awareness;
  className?: string;
}

export function Editor({ doc, awareness, className }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [lang, setLang] = useState("en");

  // Track dominant script of the document so CSS word-break rules apply.
  useEffect(() => {
    const ytext = doc.getText("content");
    const update = () => setLang(detectLang(ytext.toString()));
    update();
    ytext.observe(update);
    return () => ytext.unobserve(update);
  }, [doc]);

  useEffect(() => {
    if (!hostRef.current) return;
    const ytext = doc.getText("content");

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        yCollab(ytext, awareness),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "15px",
            fontFamily:
              "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
          },
          ".cm-scroller": {
            fontFamily: "inherit",
            padding: "24px max(24px, calc((100% - 760px) / 2))",
            lineHeight: "1.7",
          },
          ".cm-content": { caretColor: "hsl(var(--foreground))" },
          ".cm-cursor": { borderLeftColor: "hsl(var(--foreground))" },
          "&.cm-focused": { outline: "none" },
          ".cm-gutters": { display: "none" },
          ".cm-activeLine": { backgroundColor: "transparent" },
          ".cm-line": { padding: "0" },
          ".ͼ1 .cm-header": { fontWeight: "700" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [doc, awareness]);

  return <div ref={hostRef} lang={lang} className={className} />;
}
