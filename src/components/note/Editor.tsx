import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

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
import { EditorView, keymap, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { completionKeymap } from "@codemirror/autocomplete";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { slashCommands } from "@/lib/slash-commands";
import { tagCompletion } from "@/lib/tag-completion";

interface EditorProps {
  doc: Y.Doc;
  awareness: Awareness;
  className?: string;
}

export interface EditorHandle {
  /** Scroll to a 0-indexed line and place the cursor there. */
  jumpToLine: (line: number) => void;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { doc, awareness, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [lang, setLang] = useState("en");

  useImperativeHandle(
    ref,
    () => ({
      jumpToLine: (line: number) => {
        const view = viewRef.current;
        if (!view) return;
        const total = view.state.doc.lines;
        const target = Math.max(1, Math.min(total, line + 1));
        const linePos = view.state.doc.line(target);
        view.dispatch({
          selection: { anchor: linePos.from },
          effects: EditorView.scrollIntoView(linePos.from, { y: "start", yMargin: 16 }),
        });
        view.focus();
      },
    }),
    [],
  );

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
        search({ top: true }),
        highlightSelectionMatches(),
        slashCommands(),
        tagCompletion(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
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

    // Global Cmd/Ctrl+F → open the CodeMirror search panel even if focus is outside.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F") && !e.shiftKey && !e.altKey) {
        // Allow native find inside form inputs.
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        e.preventDefault();
        view.focus();
        openSearchPanel(view);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      view.destroy();
      viewRef.current = null;
    };
  }, [doc, awareness]);

  return <div ref={hostRef} lang={lang} className={className} />;
});
