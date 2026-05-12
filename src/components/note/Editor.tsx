import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Compartment } from "@codemirror/state";

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
import { tagHighlight } from "@/lib/tag-highlight";
import { pasteMarkdown } from "@/lib/paste-markdown";
import { tableNav } from "@/lib/table-nav";
import { typewriterMode } from "@/lib/typewriter";
import { wikiLink } from "@/lib/wiki-link";

interface EditorProps {
  doc: Y.Doc;
  awareness: Awareness;
  className?: string;
  /** Called with the scrollable DOM element (`view.scrollDOM`) when the
   *  editor mounts, and with null when it unmounts. Used by the scroll-sync
   *  hook in NotePage to mirror scroll position into the preview pane. */
  onScrollEl?: (el: HTMLElement | null) => void;
  /** Vim mode toggle. Lazy-loads `@replit/codemirror-vim` on first enable
   *  via a Compartment so the editor itself doesn't need to be re-created. */
  vim?: boolean;
}

export interface EditorHandle {
  /** Scroll to a 0-indexed line and place the cursor there. */
  jumpToLine: (line: number) => void;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { doc, awareness, className, onScrollEl, vim = false },
  ref,
) {
  // Stable Compartment lives across re-renders so reconfigure() targets the
  // same slot. Re-creating it would force the editor to drop vim state.
  const vimCompartment = useMemo(() => new Compartment(), []);
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
  // Recompute is throttled (debounce + only on length deltas > 500 chars) so
  // typing into a long doc doesn't pay scanner cost on every keystroke.
  useEffect(() => {
    const ytext = doc.getText("content");
    let lastLen = -1;
    let timer: number | null = null;
    const update = () => {
      const t = ytext.toString();
      if (lastLen === -1 || Math.abs(t.length - lastLen) > 500) {
        lastLen = t.length;
        setLang(detectLang(t));
      }
    };
    update();
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(update, 250);
    };
    ytext.observe(schedule);
    return () => {
      if (timer) window.clearTimeout(timer);
      ytext.unobserve(schedule);
    };
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
        tagHighlight(),
        wikiLink(),
        tableNav(),
        pasteMarkdown(),
        typewriterMode(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
        EditorView.lineWrapping,
        yCollab(ytext, awareness),
        // Empty slot — Vim extension is appended later via Compartment so
        // the heavy `@replit/codemirror-vim` chunk only loads on demand.
        vimCompartment.of([]),
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
    onScrollEl?.(view.scrollDOM);

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
      onScrollEl?.(null);
      view.destroy();
      viewRef.current = null;
    };
  }, [doc, awareness, onScrollEl, vimCompartment]);

  // Toggle vim mode without recreating the editor. Lazy-imports the chunk
  // on first enable; subsequent toggles reuse the module.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let cancelled = false;
    if (vim) {
      void import("@replit/codemirror-vim").then(({ vim: vimExt }) => {
        if (cancelled || !viewRef.current) return;
        viewRef.current.dispatch({ effects: vimCompartment.reconfigure(vimExt()) });
      });
    } else {
      view.dispatch({ effects: vimCompartment.reconfigure([]) });
    }
    return () => {
      cancelled = true;
    };
  }, [vim, vimCompartment]);

  return <div ref={hostRef} lang={lang} className={className} />;
});
