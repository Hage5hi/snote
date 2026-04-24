// Wiki-style `[[slug]]` links. Three pieces live in this file:
//   1. `wikiLink()` — CodeMirror extension that decorates `[[slug]]` tokens
//      and navigates on Ctrl/Cmd+click. Navigation is done by dispatching a
//      CustomEvent so the extension doesn't need to know about react-router;
//      NotePage listens and calls `navigate()`.
//   2. `WIKI_LINK_RE` — shared regex used by both the editor decoration and
//      the preview preprocessing.
//   3. `expandWikiLinks(src)` — turns `[[slug]]` into `[slug](/slug)` so the
//      existing marked pipeline renders it as a normal link. Markdown code
//      blocks are already escaped by marked after the rewrite, so code spans
//      will just show the expanded text verbatim (acceptable).
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// Matches `[[anything not containing [ ] or newline]]`. Slugs in snotes are
// free-form URL paths so we don't validate the content here — the navigation
// target will just 404 if the slug is invalid.
export const WIKI_LINK_RE = /\[\[([^[\]\n|]+)\]\]/g;

const wikiMark = Decoration.mark({ class: "cm-wiki-link" });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    WIKI_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_LINK_RE.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      builder.add(start, end, wikiMark);
    }
  }
  return builder.finish();
}

export const WIKI_NAV_EVENT = "snotes:wiki-nav";

export function wikiLink() {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) {
            this.decorations = buildDecorations(u.view);
          }
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
        if (!span) return false;
        const text = span.textContent ?? "";
        const m = text.match(/^\[\[([^[\]\n|]+)\]\]$/);
        if (!m) {
          // Fallback: resolve document position at click coords and extract
          // the token from the doc directly. Guards against stale split DOM.
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos);
          WIKI_LINK_RE.lastIndex = 0;
          let hit: RegExpExecArray | null;
          while ((hit = WIKI_LINK_RE.exec(line.text)) !== null) {
            const absFrom = line.from + hit.index;
            const absTo = absFrom + hit[0].length;
            if (pos >= absFrom && pos <= absTo) {
              const slug = hit[1].trim();
              if (!slug) return false;
              event.preventDefault();
              window.dispatchEvent(new CustomEvent(WIKI_NAV_EVENT, { detail: { slug } }));
              return true;
            }
          }
          return false;
        }
        const slug = m[1].trim();
        if (!slug) return false;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(WIKI_NAV_EVENT, { detail: { slug } }));
        return true;
      },
    }),
    EditorView.theme({
      ".cm-wiki-link": {
        color: "hsl(var(--primary))",
        textDecoration: "underline",
        textUnderlineOffset: "3px",
      },
    }),
  ];
}

// Combined matcher: fenced code block (``` or ~~~) | inline code span |
// wiki link. Code alternatives are preserved verbatim; only the wiki-link
// branch is expanded, so `[[slug]]` inside fences or `backticks` stays raw.
const WIKI_EXPAND_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|\[\[([^[\]\n|]+)\]\])/g;

/**
 * Rewrites `[[slug]]` → `[slug](/slug)` so the marked pipeline in Preview can
 * render it as a link. Skips matches inside fenced code blocks and inline
 * code spans. Returns input unchanged if no matches.
 */
export function expandWikiLinks(src: string): string {
  return src.replace(WIKI_EXPAND_RE, (match, _full: string, slug?: string) => {
    if (slug === undefined) return match; // code fence / inline code
    const s = slug.trim();
    if (!s) return match;
    // URL-encode the slug for the href only; keep the raw slug as link text.
    return `[${s}](/${encodeURIComponent(s)})`;
  });
}
