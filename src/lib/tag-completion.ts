import { autocompletion, type CompletionContext, type Completion } from "@codemirror/autocomplete";
import { extractTags } from "@/lib/tags";

/**
 * Autocomplete `#tag` from tags already present in the current document.
 *
 * Trigger:
 *  - User typed `#` followed by 0+ tag chars
 *  - The `#` must be at start-of-line OR preceded by whitespace/punctuation
 *    (mirrors the parser in `lib/tags.ts` so suggestions only appear where
 *    a tag would actually be recognized).
 */
function tagSource(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);

  // Find the trailing `#word` token (if any).
  const match = beforeCursor.match(/(^|[\s(\[{])#([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF-]*)$/);
  if (!match) return null;

  const tagPart = match[2];
  // Position where the `#` starts.
  const hashOffset = beforeCursor.length - tagPart.length - 1;
  const from = line.from + hashOffset;
  const to = context.pos;

  // Pull existing tags from the whole document so users converge on a small
  // shared vocabulary instead of typo'd duplicates.
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
}

export function tagCompletion() {
  return autocompletion({
    override: [tagSource],
    activateOnTyping: true,
    closeOnBlur: true,
    icons: false,
  });
}
