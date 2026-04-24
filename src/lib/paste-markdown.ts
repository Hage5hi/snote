// Detect structured HTML on paste (from ChatGPT / Word / web) and convert to
// Markdown before inserting into the editor. Falls through to default paste
// when the clipboard only has plain text or the user holds Shift (the browser
// convention for "paste without formatting").
//
// Turndown (+ GFM plugin for tables/strikethrough/task lists) is loaded
// lazily on first structured-HTML paste so the editor bundle doesn't grow
// for users who only type.
import { EditorView } from "@codemirror/view";

type Converter = { convert: (html: string) => string };
let converterPromise: Promise<Converter> | null = null;

function loadConverter(): Promise<Converter> {
  if (!converterPromise) {
    const p: Promise<Converter> = Promise.all([
      import("turndown"),
      import("turndown-plugin-gfm" as string) as Promise<{
        gfm: (service: unknown) => void;
      }>,
    ]).then(([td, gfm]) => {
      const TurndownService = td.default;
      const service = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        emDelimiter: "_",
      });
      service.use(gfm.gfm);
      return { convert: (html: string) => service.turndown(html) };
    });
    // Don't cache the rejection — a transient chunk-loading failure shouldn't
    // disable structured paste for the rest of the session.
    p.catch(() => {
      if (converterPromise === p) converterPromise = null;
    });
    converterPromise = p;
  }
  return converterPromise;
}

// Cheap pre-filter: only spend cycles on turndown if the HTML contains tags
// that actually convey structure. Avoids paying conversion cost for Word's
// fully-wrapped plain runs, for example.
const STRUCTURED_TAG_RE =
  /<(h[1-6]|strong|em|b|i|u|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|blockquote|a\b|img|hr)\b/i;

// Turndown emits `[text](url"title")` (no space before the quote), which is
// invalid per CommonMark. Normalise to `[text](url "title")`.
export function fixTurndownLinks(md: string): string {
  return md.replace(/\]\(([^()\s"]+)"([^"]*)"\)/g, ']($1 "$2")');
}

// Strict: must be a single http(s) URL, nothing else. Matches the clipboard
// content you get from a browser address bar or "Copy link" context menu.
const PURE_URL_RE = /^https?:\/\/\S+$/;

/** Exported for unit tests. */
export function isPureHttpUrl(s: string): boolean {
  return PURE_URL_RE.test(s.trim());
}

// Selection text that's already a markdown link — skip wrapping to avoid
// `[[old](oldurl)](newurl)` nonsense.
const ALREADY_MD_LINK_RE = /^\[[^\]]*\]\([^)]+\)$/;

export function pasteMarkdown() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const clipboard = event.clipboardData;
      if (!clipboard) return false;
      // Shift held = user wants raw paste, standard OS convention.
      if ((event as ClipboardEvent & { shiftKey?: boolean }).shiftKey) return false;

      // Smart paste URL onto selection: if the clipboard contains only a pure
      // http(s) URL and the editor has a non-empty selection, wrap the
      // selection as `[selection](url)`. Cursor lands after the closing `)`.
      const { from, to } = view.state.selection.main;
      if (from !== to) {
        const plain = clipboard.getData("text/plain");
        if (plain && isPureHttpUrl(plain)) {
          const selText = view.state.doc.sliceString(from, to);
          if (selText && !ALREADY_MD_LINK_RE.test(selText)) {
            const wrapped = `[${selText}](${plain.trim()})`;
            event.preventDefault();
            view.dispatch({
              changes: { from, to, insert: wrapped },
              selection: { anchor: from + wrapped.length },
              scrollIntoView: true,
            });
            return true;
          }
        }
      }

      const html = clipboard.getData("text/html");
      if (!html || !STRUCTURED_TAG_RE.test(html)) return false;

      // ClipboardData is only readable inside the synchronous paste handler —
      // it's cleared once the handler returns. Capture the plain-text fallback
      // now so the async catch branch still has it.
      const plainFallback = clipboard.getData("text/plain");

      event.preventDefault();

      // Use the live selection at dispatch time, not positions captured at
      // paste-event time: on the first structured paste turndown is fetched
      // lazily, and yjs remote edits arriving in that window would shift the
      // original from/to out from under us. CodeMirror maps selections
      // through incoming ChangeSets automatically.
      const insertAtCurrentSelection = (md: string) => {
        if (!md) return;
        const { from: insFrom, to: insTo } = view.state.selection.main;
        view.dispatch({
          changes: { from: insFrom, to: insTo, insert: md },
          selection: { anchor: insFrom + md.length },
          scrollIntoView: true,
        });
      };

      loadConverter().then(
        ({ convert }) => {
          let md = "";
          try {
            md = fixTurndownLinks(convert(html)).trim();
          } catch {
            // Turndown choke → fall back to whatever plain text we had.
            md = plainFallback;
          }
          insertAtCurrentSelection(md);
        },
        // Dynamic-import failure (chunk load error, offline, etc.) — don't
        // silently drop the paste; insert the plain-text fallback instead.
        () => insertAtCurrentSelection(plainFallback),
      );
      return true;
    },
  });
}
