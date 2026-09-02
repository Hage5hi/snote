// Wiki-style `[[slug]]` and `[[slug|display]]` links. Three pieces live here:
//   1. `wikiLink()` — CodeMirror extension that decorates tokens and navigates
//      on Ctrl/Cmd+click. Navigation dispatches a CustomEvent so the extension
//      doesn't need react-router; NotePage / SplitView listen and navigate.
//   2. `WIKI_LINK_RE` — shared regex used by the editor decoration.
//   3. `expandWikiLinks(src)` / `extractWikiLinks(src)` — preview rewrite and
//      client-only graph extraction. Both skip fenced and inline code.
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, Transaction } from "@codemirror/state";

export type ParsedWikiLink = {
  display: string;
  slug: string;
  aliased: boolean;
};

export type WikiLinkHit = ParsedWikiLink & {
  raw: string;
  from: number;
  to: number;
};

// Matches `[[anything not containing [ ] or newline]]`, including aliases
// `[[slug|display]]` (destination first, optional label after `|`).
// Negative lookbehind keeps `![[slug]]` transcludes out of wiki expansion
// so they cannot become markdown images.
export const WIKI_LINK_RE = /(?<!!)\[\[([^[\]\n]+)\]\]/g;
const TRANSCLUDE_RE = /!\[\[([^[\]\n]+)\]\]/g;

const wikiMark = Decoration.mark({ class: "cm-wiki-link" });

let deadLookup: ((slug: string) => boolean) | null = null;

export const WIKI_KNOWN_CHANGE_EVENT = "snotes:wiki-known";

export function setWikiLinkDeadLookup(fn: ((slug: string) => boolean) | null) {
  deadLookup = fn;
  emitWikiKnownChange();
}

export function emitWikiKnownChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WIKI_KNOWN_CHANGE_EVENT));
}

function isDead(slug: string): boolean {
  return deadLookup?.(slug) === true;
}

export function parseWikiLinkInner(inner: string): ParsedWikiLink | null {
  const pipe = inner.indexOf("|");
  if (pipe === -1) {
    const slug = inner.trim();
    if (!slug) return null;
    return { display: slug, slug, aliased: false };
  }
  const slug = inner.slice(0, pipe).trim();
  const display = inner.slice(pipe + 1).trim();
  if (!display || !slug) return null;
  return { display, slug, aliased: true };
}

function hitFromRegex(
  lineText: string,
  column: number,
  regex: RegExp,
): WikiLinkHit | null {
  regex.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = regex.exec(lineText)) !== null) {
    const from = hit.index;
    const to = from + hit[0].length;
    if (column >= from && column <= to) {
      const parsed = parseWikiLinkInner(hit[1]);
      if (!parsed) return null;
      return { ...parsed, raw: hit[0], from, to };
    }
  }
  return null;
}

export function wikiLinkAt(lineText: string, column: number): WikiLinkHit | null {
  return hitFromRegex(lineText, column, TRANSCLUDE_RE) ?? hitFromRegex(lineText, column, WIKI_LINK_RE);
}

function markFor(parsed: ParsedWikiLink): Decoration {
  const dead = isDead(parsed.slug);
  if (!parsed.aliased && !dead) return wikiMark;
  return Decoration.mark({
    class: dead ? "cm-wiki-link cm-wiki-link-dead" : "cm-wiki-link",
    attributes: { title: parsed.slug },
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    WIKI_LINK_RE.lastIndex = 0;
    TRANSCLUDE_RE.lastIndex = 0;
    const hits: { start: number; end: number; parsed: ParsedWikiLink }[] = [];
    let m: RegExpExecArray | null;
    while ((m = TRANSCLUDE_RE.exec(text)) !== null) {
      const parsed = parseWikiLinkInner(m[1]);
      if (!parsed) continue;
      hits.push({ start: from + m.index, end: from + m.index + m[0].length, parsed });
    }
    while ((m = WIKI_LINK_RE.exec(text)) !== null) {
      const parsed = parseWikiLinkInner(m[1]);
      if (!parsed) continue;
      hits.push({ start: from + m.index, end: from + m.index + m[0].length, parsed });
    }
    hits.sort((a, b) => a.start - b.start || a.end - b.end);
    for (const hit of hits) {
      builder.add(hit.start, hit.end, markFor(hit.parsed));
    }
  }
  return builder.finish();
}

export const WIKI_NAV_EVENT = "snotes:wiki-nav";

export function dispatchWikiNav(slug: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WIKI_NAV_EVENT, { detail: { slug } }));
}

export function wikiLink() {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        private readonly unsub: () => void;
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
          const refresh = () => {
            this.decorations = buildDecorations(view);
            view.dispatch({
              annotations: Transaction.addToHistory.of(false),
            });
          };
          window.addEventListener(WIKI_KNOWN_CHANGE_EVENT, refresh);
          this.unsub = () => window.removeEventListener(WIKI_KNOWN_CHANGE_EVENT, refresh);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) {
            this.decorations = buildDecorations(u.view);
          }
        }
        destroy() {
          this.unsub();
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const target = event.target as HTMLElement | null;
        // Walk up to find the full wiki-link span — overlapping decorations
        // (e.g. selection-match highlight) can split the link into multiple
        // sub-spans, so event.target may only cover a fragment.
        const span = target?.closest?.(".cm-wiki-link") as HTMLElement | null;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        let hit: WikiLinkHit | null = null;
        if (span) {
          const text = span.textContent ?? "";
          const wrapped = text.match(/^!?\[\[([^[\]\n]+)\]\]$/);
          if (wrapped) {
            const parsed = parseWikiLinkInner(wrapped[1]);
            if (parsed) hit = { ...parsed, raw: text, from: 0, to: text.length };
          }
        }
        if (!hit) {
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos);
          hit = wikiLinkAt(line.text, pos - line.from);
        }
        if (!hit) return false;
        event.preventDefault();
        dispatchWikiNav(hit.slug);
        return true;
      },
    }),
    EditorView.theme({
      ".cm-wiki-link": {
        color: "hsl(var(--primary))",
        textDecoration: "underline",
        textUnderlineOffset: "3px",
      },
      ".cm-wiki-link-dead": {
        color: "hsl(var(--muted-foreground))",
        textDecorationLine: "underline",
        textDecorationStyle: "dotted",
        textUnderlineOffset: "3px",
      },
    }),
  ];
}

// Combined matcher: fenced code block (``` or ~~~) | inline code span |
// wiki link. Code alternatives are preserved verbatim; only the wiki-link
// branch is expanded, so `[[slug]]` inside fences or `backticks` stays raw.
const WIKI_EXPAND_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|(?<!!)\[\[([^[\]\n]+)\]\])/g;

export type ExtractedWikiLink = ParsedWikiLink & { raw: string };

/**
 * Collects wiki links from plaintext, skipping fenced and inline code.
 * Used by the client-only knowledge index — never send this graph to a server.
 */
export function extractWikiLinks(src: string): ExtractedWikiLink[] {
  const out: ExtractedWikiLink[] = [];
  WIKI_EXPAND_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_EXPAND_RE.exec(src)) !== null) {
    if (m[2] === undefined) continue;
    const parsed = parseWikiLinkInner(m[2]);
    if (parsed) out.push({ ...parsed, raw: m[0] });
  }
  return out;
}

/**
 * Rewrites `[[slug]]` → `[slug](/slug)` and `[[slug|display]]` →
 * `[display](/slug)` so the marked pipeline in Preview can render a link.
 * Skips matches inside fenced code blocks and inline code spans.
 * Returns input unchanged if no matches.
 */
export function expandWikiLinks(src: string): string {
  return src.replace(WIKI_EXPAND_RE, (match, _full: string, inner?: string) => {
    if (inner === undefined) return match; // code fence / inline code
    const parsed = parseWikiLinkInner(inner);
    if (!parsed) return match;
    // Link labels go through marked + DOMPurify. Strip markup characters so
    // an alias cannot inject HTML into the preview.
    const label = parsed.display.replace(/[<>[\]]/g, "") || parsed.slug;
    return `[${label}](/${encodeURIComponent(parsed.slug)})`;
  });
}
