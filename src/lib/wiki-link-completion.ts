// Autocomplete source for `[[slug`. Pulls slugs from recent-notes so the
// user can quickly link to notes they've already opened. Registered via
// `slashCommands()` alongside the slash-command and tag-completion sources
// (a single `autocompletion()` extension is required — see slash-commands.ts).
import type { CompletionContext, CompletionSource, Completion } from "@codemirror/autocomplete";
import { getRecents } from "@/lib/recent-notes";

export const wikiLinkCompletionSource: CompletionSource = (context: CompletionContext) => {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);

  // Only trigger after `[[` that isn't already closed on this side of the cursor.
  const match = beforeCursor.match(/\[\[([^[\]\n|]*)$/);
  if (!match) return null;

  const query = match[1];
  const from = context.pos - query.length;
  const to = context.pos;

  const recents = getRecents();
  if (recents.length === 0 && !context.explicit) return null;

  const options: Completion[] = recents.map((r) => ({
    label: r.slug,
    detail: r.preview?.slice(0, 40),
    type: "text",
    apply: `${r.slug}]] `,
  }));

  return {
    from,
    to,
    options,
    filter: true,
    // Keep popup open while user keeps typing slug chars.
    validFor: /^[^[\]\n|]*$/,
  };
};
