import { autocompletion, type CompletionContext, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { detectLang, translateLoaded, type TKey } from "@/i18n";
import { tagCompletionSource } from "@/lib/tag-completion";
import { wikiLinkCompletionSource } from "@/lib/wiki-link-completion";

/**
 * Insert a snippet at the current selection. Replaces the matched "/foo" prefix
 * captured by the completion source so the slash itself disappears.
 */
function insertSnippet(view: EditorView, from: number, to: number, snippet: string, cursorOffset?: number) {
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: { anchor: from + (cursorOffset ?? snippet.length) },
    scrollIntoView: true,
  });
}

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function calloutSnippet(type: "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION") {
  const text = `> [!${type}]\n> `;
  return { text, cursor: text.length };
}

export interface SlashItem {
  label: string;
  detail: string;
  build?: () => { text: string; cursor?: number };
  apply?: (view: EditorView, from: number, to: number) => void;
}

export function slashItems(t: (key: TKey) => string): SlashItem[] {
  return [
    { label: "/h1", detail: "Heading 1", build: () => ({ text: "# " }) },
    { label: "/h2", detail: "Heading 2", build: () => ({ text: "## " }) },
    { label: "/h3", detail: "Heading 3", build: () => ({ text: "### " }) },
    {
      label: "/code",
      detail: "Fenced code block",
      build: () => ({ text: "```\n\n```\n", cursor: 4 }),
    },
    {
      label: "/mermaid",
      detail: t("slash.detail.mermaid"),
      build: () => ({ text: "```mermaid\n\n```\n", cursor: "```mermaid\n".length }),
    },
    {
      label: "/math",
      detail: t("slash.detail.math"),
      build: () => ({ text: "```math\n\n```\n", cursor: "```math\n".length }),
    },
    {
      label: "/clip",
      detail: t("slash.detail.clip"),
      apply: (view, from, to) => {
        void import("@/lib/paste-markdown").then((m) =>
          m.applyClipSlash(view, from, to),
        );
      },
    },
    {
      label: "/table",
      detail: "Markdown table",
      build: () => ({
        text: "| Cột 1 | Cột 2 | Cột 3 |\n| --- | --- | --- |\n|  |  |  |\n",
        cursor: 2,
      }),
    },
    { label: "/date", detail: "Insert today's date", build: () => ({ text: todayIso() + " " }) },
    { label: "/todo", detail: "Checkbox list", build: () => ({ text: "- [ ] " }) },
    { label: "/quote", detail: "Block quote", build: () => ({ text: "> " }) },
    { label: "/note", detail: t("slash.detail.note"), build: () => calloutSnippet("NOTE") },
    { label: "/tip", detail: t("slash.detail.tip"), build: () => calloutSnippet("TIP") },
    {
      label: "/important",
      detail: t("slash.detail.important"),
      build: () => calloutSnippet("IMPORTANT"),
    },
    { label: "/warning", detail: t("slash.detail.warning"), build: () => calloutSnippet("WARNING") },
    { label: "/caution", detail: t("slash.detail.caution"), build: () => calloutSnippet("CAUTION") },
    { label: "/hr", detail: "Horizontal rule", build: () => ({ text: "\n---\n\n" }) },
  ];
}

/**
 * CodeMirror autocomplete source that fires when the user types "/" at the
 * START of a line (the only spot where a Notion-style slash command makes
 * sense — avoids popping up inside URLs, code, etc.).
 */
export const slashCompletionSource: CompletionSource = (context: CompletionContext) => {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  const clipWithArgs = /^\/clip(?:\s.*)$/i.test(beforeCursor);
  const generic = /^\/(\w*)$/.test(beforeCursor);
  if (!clipWithArgs && !generic) return null;

  const from = line.from;
  const to = context.pos;
  const allItems = slashItems((key) => translateLoaded(detectLang(), key));
  const items = clipWithArgs
    ? allItems.filter((item) => item.label === "/clip")
    : allItems;

  const options: Completion[] = items.map((item) => ({
    label: item.label,
    detail: item.detail,
    type: "keyword",
    apply: (view, _completion, _fromPos, toPos) => {
      if (item.apply) {
        item.apply(view, from, toPos);
        return;
      }
      const snippet = item.build?.();
      if (!snippet) return;
      insertSnippet(view, from, toPos, snippet.text, snippet.cursor);
    },
  }));

  return {
    from,
    to,
    options,
    filter: !clipWithArgs,
  };
};

/**
 * Combined autocompletion extension that handles both `/slash-commands` and
 * `#tag` suggestions. We MUST register a single `autocompletion()` because
 * its `override` config is a one-shot facet — multiple instances clash with
 * "Config merge conflict for field override".
 */
export function slashCommands() {
  return autocompletion({
    override: [slashCompletionSource, tagCompletionSource, wikiLinkCompletionSource],
    activateOnTyping: true,
    closeOnBlur: true,
    icons: false,
  });
}
