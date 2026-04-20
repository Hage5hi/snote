import type { CompletionContext, CompletionSource, Completion } from "@codemirror/autocomplete";
import { extractTags } from "@/lib/tags";

/**
 * Autocomplete `#tag` from tags already present in the current document.
 *
 * Trigger:
 *  - User typed `#` followed by 0+ tag chars
 *  - The `#` must be at start-of-line OR preceded by whitespace/punctuation
 *    (mirrors the parser in `lib/tags.ts` so suggestions only appear where
 *    a tag would actually be recognized).
 *
 * Exported as a bare CompletionSource — `slashCommands` registers the single
 * `autocompletion()` extension and combines this source with `/` snippets.
 * Two separate `autocompletion()` calls would clash on the `override` facet
 * with "Config merge conflict for field override".
 */
export const tagCompletionSource: CompletionSource = (context: CompletionContext) => {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);

  const match = beforeCursor.match(/(^|[\s(\[{])#([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF-]*)$/);
  if (!match) return null;

  const tagPart = match[2];
  const hashOffset = beforeCursor.length - tagPart.length - 1;
  const from = line.from + hashOffset;
  const to = context.pos;

  const allText = context.state.doc.toString();
  const existing = extractTags(allText);
  if (existing.length === 0 && !context.explicit) return null;

  const options: Completion[] = existing.map((tag) => ({
    label: `#${tag}`,
    type: "constant",
    apply: `#${tag} `,
  }));

  return {
    from,
    to,
    options,
    filter: true,
    validFor: /^#[a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF-]*$/,
  };
};
