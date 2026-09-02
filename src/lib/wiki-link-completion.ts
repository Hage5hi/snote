// Autocomplete source for `[[slug` and `[[display|slug`. Suggests from the
// client-only knowledge index (plaintext already on this device) plus recents
// and pins. Registered via `slashCommands()` alongside slash-command and tag
// sources (a single `autocompletion()` extension is required).
import type { CompletionContext, CompletionSource, Completion } from "@codemirror/autocomplete";
import { getPinned, getRecents } from "@/lib/recent-notes";
import {
  filterWikiCompletions,
  type WikiCompletionCandidate,
} from "@/lib/note-graph";
import { getNoteIndexSnapshot, hydrateNoteIndex } from "@/lib/note-index";

export function wikiLinkQueryAt(beforeCursor: string): string | null {
  const alias = beforeCursor.match(/\[\[[^[\]\n|]+\|([^[\]\n|]*)$/);
  if (alias) return alias[1];
  const simple = beforeCursor.match(/\[\[([^[\]\n|]*)$/);
  if (simple) return simple[1];
  return null;
}

export function collectWikiCompletionCandidates(): WikiCompletionCandidate[] {
  const bySlug = new Map<string, WikiCompletionCandidate>();
  const put = (candidate: WikiCompletionCandidate) => {
    const prev = bySlug.get(candidate.slug);
    if (!prev) {
      bySlug.set(candidate.slug, { ...candidate });
      return;
    }
    prev.boost = Math.max(prev.boost, candidate.boost);
    prev.title = prev.title || candidate.title;
    prev.headings = prev.headings?.length ? prev.headings : candidate.headings;
    prev.preview = prev.preview || candidate.preview;
  };
  for (const entry of getNoteIndexSnapshot()) {
    put({
      slug: entry.slug,
      title: entry.title,
      headings: entry.headings,
      boost: 1,
    });
  }
  for (const recent of getRecents()) {
    put({ slug: recent.slug, preview: recent.preview, boost: 2 });
  }
  for (const slug of getPinned()) {
    put({ slug, boost: 3 });
  }
  return [...bySlug.values()];
}

export const wikiLinkCompletionSource: CompletionSource = (context: CompletionContext) => {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  const query = wikiLinkQueryAt(beforeCursor);
  if (query === null) return null;

  const from = context.pos - query.length;
  const to = context.pos;

  void hydrateNoteIndex();
  const candidates = collectWikiCompletionCandidates();
  if (candidates.length === 0 && !context.explicit) return null;

  const options: Completion[] = filterWikiCompletions(query, candidates).map((candidate) => ({
    label: candidate.slug,
    detail: candidate.title ?? candidate.preview?.slice(0, 40),
    type: "text",
    apply: `${candidate.slug}]] `,
  }));

  return {
    from,
    to,
    options,
    // Title/heading matches must survive even when the query is not a slug prefix.
    filter: false,
    validFor: /^[^[\]\n|]*$/,
  };
};
