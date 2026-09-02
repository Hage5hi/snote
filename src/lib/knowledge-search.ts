/**
 * Client-only command-palette search over plaintext this device already has.
 *
 * Sources: the in-memory knowledge index (titles/headings/tags/session snippet)
 * plus Home recents preview already in localStorage. Never uploads, never
 * opens `note:${slug}` Yjs IDB, never copies recents preview into knowledge IDB.
 */
import { getPinned, getRecents } from "@/lib/recent-notes";
import { getNoteIndexSnapshot } from "@/lib/note-index";
import { extractTags } from "@/lib/tags";

export type KnowledgeQuery = {
  raw: string;
  /** Lowercased leftover text after a leading #tag, or the whole query. */
  text: string;
  /** Lowercased tag without `#`. `""` = user typed only `#`. `null` = no tag filter. */
  tag: string | null;
};

export type KnowledgeSearchDoc = {
  slug: string;
  title?: string;
  headings: string[];
  tags: string[];
  snippet?: string;
  preview?: string;
  pinned: boolean;
  recent: boolean;
  recentAt: number;
};

export type KnowledgeMatchKind = "slug" | "title" | "heading" | "body" | "tag";

export type KnowledgeSearchHit = {
  slug: string;
  title?: string;
  snippet?: string;
  match: KnowledgeMatchKind;
};

const TAG_TOKEN = "([a-zA-Z0-9_\\u00C0-\\u024F\\u1E00-\\u1EFF-]{1,32})";
const TAG_HASH = new RegExp(`^#${TAG_TOKEN}(?:\\s+|$)(.*)$`);
const TAG_PREFIX = new RegExp(`^tag:${TAG_TOKEN}(?:\\s+|$)(.*)$`, "i");

const LIMIT = 50;

export function parseKnowledgeQuery(raw: string): KnowledgeQuery {
  const trimmed = raw.trim();
  if (trimmed === "#" || /^tag:$/i.test(trimmed)) {
    return { raw, text: "", tag: "" };
  }
  const lead = trimmed.match(TAG_HASH) ?? trimmed.match(TAG_PREFIX);
  if (lead) {
    return {
      raw,
      text: lead[2].trim().toLowerCase(),
      tag: lead[1].toLowerCase(),
    };
  }
  return { raw, text: trimmed.toLowerCase(), tag: null };
}

function haystack(doc: KnowledgeSearchDoc): string {
  return [doc.snippet, doc.preview, doc.title, ...doc.headings].filter(Boolean).join("\n");
}

function docHasTag(doc: KnowledgeSearchDoc, tag: string): boolean {
  if (doc.tags.includes(tag)) return true;
  return extractTags(haystack(doc)).includes(tag);
}

function matchKind(query: KnowledgeQuery, doc: KnowledgeSearchDoc): KnowledgeMatchKind | null {
  if (query.tag === "") return null;
  if (query.tag && !docHasTag(doc, query.tag)) return null;
  if (!query.text) return query.tag ? "tag" : null;

  const q = query.text;
  if (doc.slug.toLowerCase().includes(q)) return "slug";
  if (doc.title?.toLowerCase().includes(q)) return "title";
  if (doc.headings.some((heading) => heading.toLowerCase().includes(q))) return "heading";
  if ((doc.snippet ?? "").toLowerCase().includes(q)) return "body";
  if ((doc.preview ?? "").toLowerCase().includes(q)) return "body";
  return null;
}

function bucket(doc: KnowledgeSearchDoc, kind: KnowledgeMatchKind): number {
  if (doc.pinned) return 0;
  if (doc.recent) return 1;
  if (kind === "slug" || kind === "title" || kind === "heading") return 2;
  return 3;
}

function kindRank(kind: KnowledgeMatchKind): number {
  switch (kind) {
    case "slug":
      return 0;
    case "title":
      return 1;
    case "heading":
      return 2;
    case "tag":
      return 3;
    case "body":
      return 4;
  }
}

export function rankKnowledgeSearch(
  query: KnowledgeQuery,
  docs: readonly KnowledgeSearchDoc[],
  limit = LIMIT,
): KnowledgeSearchHit[] {
  const scored: Array<{
    doc: KnowledgeSearchDoc;
    kind: KnowledgeMatchKind;
    bucket: number;
  }> = [];
  for (const doc of docs) {
    const kind = matchKind(query, doc);
    if (!kind) continue;
    scored.push({ doc, kind, bucket: bucket(doc, kind) });
  }
  scored.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    const kindDelta = kindRank(a.kind) - kindRank(b.kind);
    if (kindDelta !== 0) return kindDelta;
    if (a.doc.recentAt !== b.doc.recentAt) return b.doc.recentAt - a.doc.recentAt;
    return a.doc.slug.localeCompare(b.doc.slug);
  });
  return scored.slice(0, limit).map(({ doc, kind }) => ({
    slug: doc.slug,
    title: doc.title,
    snippet: doc.snippet ?? doc.preview,
    match: kind,
  }));
}

/** Assemble search docs in memory. Does not read or write knowledge IDB. */
export function collectKnowledgeSearchDocs(): KnowledgeSearchDoc[] {
  const pinned = getPinned();
  const recents = getRecents();
  const pinnedSet = new Set(pinned);
  const recentBySlug = new Map(recents.map((row) => [row.slug, row]));
  const bySlug = new Map<string, KnowledgeSearchDoc>();

  for (const entry of getNoteIndexSnapshot()) {
    const recent = recentBySlug.get(entry.slug);
    bySlug.set(entry.slug, {
      slug: entry.slug,
      title: entry.title,
      headings: entry.headings,
      tags: entry.tags ?? [],
      snippet: entry.snippet,
      preview: recent?.preview,
      pinned: pinnedSet.has(entry.slug),
      recent: Boolean(recent),
      recentAt: recent?.lastOpenedAt ?? 0,
    });
  }
  for (const recent of recents) {
    const prev = bySlug.get(recent.slug);
    if (prev) continue;
    bySlug.set(recent.slug, {
      slug: recent.slug,
      headings: [],
      tags: extractTags(recent.preview ?? ""),
      preview: recent.preview,
      pinned: pinnedSet.has(recent.slug),
      recent: true,
      recentAt: recent.lastOpenedAt,
    });
  }
  for (const slug of pinned) {
    if (bySlug.has(slug)) continue;
    bySlug.set(slug, {
      slug,
      headings: [],
      tags: [],
      pinned: true,
      recent: false,
      recentAt: 0,
    });
  }
  return [...bySlug.values()];
}
