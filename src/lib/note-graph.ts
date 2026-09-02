import { parseOutline } from "@/lib/outline";
import { extractTags } from "@/lib/tags";
import { extractWikiLinks } from "@/lib/wiki-link";

export type NoteGraphRecord = {
  slug: string;
  title?: string;
  headings: string[];
  outgoingLinks: string[];
  tags: string[];
};

const MAX_HEADINGS = 40;
const MAX_OUTGOING = 100;
const MAX_TITLE = 200;

/** Derive a local knowledge record from plaintext the client already has. */
export function buildNoteGraphRecord(slug: string, content: string): NoteGraphRecord {
  const headings = parseOutline(content).map((heading) => heading.text).slice(0, MAX_HEADINGS);
  const title = headings[0]?.slice(0, MAX_TITLE) || undefined;
  const outgoing: string[] = [];
  const seen = new Set<string>();
  for (const link of extractWikiLinks(content)) {
    if (link.slug === slug || seen.has(link.slug)) continue;
    seen.add(link.slug);
    outgoing.push(link.slug);
    if (outgoing.length >= MAX_OUTGOING) break;
  }
  return { slug, title, headings, outgoingLinks: outgoing, tags: extractTags(content) };
}

export function backlinksTo(
  entries: readonly NoteGraphRecord[],
  targetSlug: string,
): NoteGraphRecord[] {
  return entries
    .filter((entry) => entry.slug !== targetSlug && entry.outgoingLinks.includes(targetSlug))
    .sort((a, b) => (a.title ?? a.slug).localeCompare(b.title ?? b.slug));
}

export function deadOutgoing(
  outgoing: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  if (known.size === 0) return [];
  return outgoing.filter((slug) => !known.has(slug));
}

export function isOrphanNote(outgoingCount: number, backlinkCount: number): boolean {
  return outgoingCount === 0 && backlinkCount === 0;
}

export type WikiCompletionCandidate = {
  slug: string;
  title?: string;
  headings?: string[];
  preview?: string;
  boost: number;
};

export function wikiCandidateMatches(candidate: WikiCompletionCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (candidate.slug.toLowerCase().includes(q)) return true;
  if (candidate.title?.toLowerCase().includes(q)) return true;
  if (candidate.preview?.toLowerCase().includes(q)) return true;
  return candidate.headings?.some((heading) => heading.toLowerCase().includes(q)) ?? false;
}

export function filterWikiCompletions(
  query: string,
  candidates: readonly WikiCompletionCandidate[],
  limit = 50,
): WikiCompletionCandidate[] {
  const matched = candidates.filter((candidate) => wikiCandidateMatches(candidate, query));
  matched.sort((a, b) => b.boost - a.boost || a.slug.localeCompare(b.slug));
  return matched.slice(0, limit);
}
