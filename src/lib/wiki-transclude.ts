// Obsidian-style `![[slug]]` / `![[slug|display]]` transcludes.
// Preview rewrite only: inlines session plaintext the client already unlocked.
// Never fetches other users' notes or Yjs IDB. Encrypted notes the session
// has not unlocked are absent from the lookup and fail closed as dead wiki
// links. Distinct from `[[slug]]` so wiki expansion cannot turn embeds into
// images (`![slug](/slug)`).
import {
  parseWikiLinkInner,
  type ExtractedWikiLink,
  type ParsedWikiLink,
} from "@/lib/wiki-link";

export const MAX_TRANSCLUDE_DEPTH = 2;

const TRANSCLUDE_EXPAND_RE =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|!\[\[([^[\]\n]+)\]\])/g;

export type TranscludeLookup = {
  getPlaintext: (slug: string) => string | null;
};

export type ExpandTranscludeOptions = {
  currentSlug?: string;
  depth?: number;
  stack?: ReadonlySet<string>;
};

function asWikiLink(parsed: ParsedWikiLink): string {
  return parsed.aliased ? `[[${parsed.slug}|${parsed.display}]]` : `[[${parsed.slug}]]`;
}

export function extractTranscludes(src: string): ExtractedWikiLink[] {
  const out: ExtractedWikiLink[] = [];
  TRANSCLUDE_EXPAND_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRANSCLUDE_EXPAND_RE.exec(src)) !== null) {
    if (match[2] === undefined) continue;
    const parsed = parseWikiLinkInner(match[2]);
    if (parsed) out.push({ ...parsed, raw: match[0] });
  }
  return out;
}

export function expandTranscludes(
  src: string,
  lookup: TranscludeLookup,
  opts?: ExpandTranscludeOptions,
): string {
  const depth = opts?.depth ?? 0;
  const stack = new Set(opts?.stack);
  if (opts?.currentSlug) stack.add(opts.currentSlug);

  return src.replace(TRANSCLUDE_EXPAND_RE, (match, _full: string, inner?: string) => {
    if (inner === undefined) return match;
    const parsed = parseWikiLinkInner(inner);
    if (!parsed) return match;
    if (depth >= MAX_TRANSCLUDE_DEPTH || stack.has(parsed.slug)) {
      return asWikiLink(parsed);
    }
    const body = lookup.getPlaintext(parsed.slug);
    if (body === null) return asWikiLink(parsed);
    const nested = new Set(stack);
    nested.add(parsed.slug);
    return expandTranscludes(body, lookup, { depth: depth + 1, stack: nested });
  });
}
