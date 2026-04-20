// CodeMirror extension that decorates `#tag` tokens with an accent color and
// bold weight so they stand out in long notes. Uses a ViewPlugin + Decoration
// (no parser change) — cheap to apply and re-runs only on visible ranges.
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// Same shape as src/lib/tags.ts TAG_RE but local to avoid coupling.
// Match #tag preceded by start-of-line or whitespace; allow letters/digits/_-.
const TAG_RE = /(^|\s)(#[\p{L}0-9_-]{1,40})/gu;

const tagMark = Decoration.mark({ class: "cm-tag-token" });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(text)) !== null) {
      const tagStart = from + m.index + m[1].length;
      const tagEnd = tagStart + m[2].length;
      builder.add(tagStart, tagEnd, tagMark);
    }
  }
  return builder.finish();
}

export function tagHighlight() {
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
    EditorView.theme({
      ".cm-tag-token": {
        color: "hsl(var(--primary))",
        fontWeight: "600",
      },
    }),
  ];
}
