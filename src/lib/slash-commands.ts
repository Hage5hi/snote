import { autocompletion, type CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";

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

interface SlashItem {
  label: string;
  detail: string;
  build: () => { text: string; cursor?: number };
}

const ITEMS: SlashItem[] = [
  { label: "/h1", detail: "Heading 1", build: () => ({ text: "# " }) },
  { label: "/h2", detail: "Heading 2", build: () => ({ text: "## " }) },
  { label: "/h3", detail: "Heading 3", build: () => ({ text: "### " }) },
  {
    label: "/code",
    detail: "Fenced code block",
    build: () => ({ text: "```\n\n```\n", cursor: 4 }),
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
  { label: "/hr", detail: "Horizontal rule", build: () => ({ text: "\n---\n\n" }) },
];

/**
 * CodeMirror autocomplete source that fires when the user types "/" at the
 * START of a line (the only spot where a Notion-style slash command makes
 * sense — avoids popping up inside URLs, code, etc.).
 */
function slashSource(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  // Match "/word" only when it's the entire line so far (allows trailing chars
  // to filter the menu but not random midline slashes).
  const match = beforeCursor.match(/^\/(\w*)$/);
  if (!match) return null;

  const from = line.from;
  const to = context.pos;

  const options: Completion[] = ITEMS.map((item) => ({
    label: item.label,
    detail: item.detail,
    type: "keyword",
    apply: (view, _completion, fromPos, toPos) => {
      const { text, cursor } = item.build();
      insertSnippet(view, from, toPos, text, cursor);
    },
    // Fall back to plain string apply if needed.
  }));

  return {
    from,
    to,
    options,
    filter: true,
  };
}

export function slashCommands() {
  return autocompletion({
    override: [slashSource],
    activateOnTyping: true,
    closeOnBlur: true,
    icons: false,
  });
}
