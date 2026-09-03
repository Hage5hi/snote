// Detect structured HTML on paste (from ChatGPT / Word / web) and convert to
// Markdown before inserting into the editor. Falls through to default paste
// when the clipboard only has plain text or the user holds Shift (the browser
// convention for "paste without formatting").
//
// Copy-box / "copy" widgets almost always put text/html on the clipboard
// (`<a>` copy button, `<pre>`/`<code>`, or a self-href URL) even when the
// payload is a plain token or http(s) URL. Turndown's default escape then
// turns `_` into `\_`, which breaks those URLs. After convert we prefer
// text/plain when the markdown is just that plain text plus backslash
// escapes, copy-button chrome, a self-href URL, or a wrapping code span
// whose clipboard is a single http(s) URL. We do not disable Turndown's
// escape globally, and we do not unwrap real fenced code pastes.
//
// Turndown (+ GFM plugin for tables/strikethrough/task lists) is loaded
// lazily on first structured-HTML paste so the editor bundle doesn't grow
// for users who only type.
import { EditorView } from "@codemirror/view";
import { toast } from "@/hooks/use-toast";
import { detectLang, translateLoaded } from "@/i18n";

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

/**
 * Convert HTML to Markdown using the lazy Turndown+GFM path, then fix
 * Turndown's title-less-space bug and unescape `_` inside http(s) URLs.
 * Empty / converter failure → `""` (callers decide the fallback).
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  let convert: Converter["convert"];
  try {
    ({ convert } = await loadConverter());
  } catch {
    return "";
  }
  try {
    const md = fixTurndownLinks(convert(html)).trim();
    if (!md) return "";
    return unescapeUnderscoresInHttpUrls(md);
  } catch {
    return "";
  }
}

/**
 * Convert clipboard HTML the same way the editor paste handler does.
 * Exported so unit tests can exercise the decision path without CodeMirror.
 */
export async function markdownFromHtmlPaste(
  html: string,
  plainFallback: string,
): Promise<string> {
  let convert: Converter["convert"];
  try {
    ({ convert } = await loadConverter());
  } catch {
    return plainFallback;
  }
  try {
    const md = fixTurndownLinks(convert(html)).trim();
    if (!md) return plainFallback;
    if (prefersPlainClipboard(md, plainFallback)) return plainFallback;
    return unescapeUnderscoresInHttpUrls(md);
  } catch {
    return plainFallback;
  }
}

// CommonMark ASCII punctuation that a backslash can escape.
const MD_ESCAPED_PUNCT = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

function stripMarkdownBackslashEscapes(s: string): string {
  return s.replace(MD_ESCAPED_PUNCT, "$1");
}

function normalizeForCompare(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/ +\n/g, "\n")
    .trim();
}

// One wrapping fenced/indented code block, or a single inline `span`.
function unwrapSingleWrappingCode(md: string): string {
  const s = md.trim();
  const fenced = s.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1];
  const lines = s.split("\n");
  if (
    lines.length > 0 &&
    lines.every((line) => line === "" || /^(?: {4}|\t)/.test(line))
  ) {
    return lines.map((line) => line.replace(/^(?: {4}|\t)/, "")).join("\n");
  }
  const inline = s.match(/^`([^`]+)`$/);
  if (inline) return inline[1];
  return s;
}

// Whole-string `[url](url)` (Turndown escapes `_` in the link text).
function unwrapSelfUrlLink(md: string): string {
  const m = md
    .trim()
    .match(/^\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)$/);
  if (!m) return md;
  const text = stripMarkdownBackslashEscapes(m[1]);
  const href = m[2];
  return text === href ? href : md;
}

const COPY_LINK_TEXT_RE = /^(?:copy(?:\s+(?:to\s+clipboard|code))?)$/i;
// `[text](href)` allowing Turndown's `\)` inside the destination.
const MD_LINK_RE = /\[([^\]]{0,64})\]\(((?:\\.|[^)\\])*)\)/;
const MD_LINK_AT_START = new RegExp("^" + MD_LINK_RE.source + "\\s*");
const MD_LINK_AT_END = new RegExp(MD_LINK_RE.source + "\\s*$");

function isCopyChromeLinkText(text: string): boolean {
  const t = text.trim();
  return t === "" || COPY_LINK_TEXT_RE.test(t);
}

function stripCopyButtonMarkdown(md: string): string {
  let s = md.trim();
  const start = s.match(MD_LINK_AT_START);
  if (start && isCopyChromeLinkText(start[1])) {
    s = s.slice(start[0].length).trim();
  }
  const end = s.match(MD_LINK_AT_END);
  if (end && isCopyChromeLinkText(end[1])) {
    s = s.slice(0, end.index).trim();
  }
  return s;
}

function stripCopyLabelPrefix(s: string): string {
  return s.replace(
    /^(?:copy(?:\s+(?:to\s+clipboard|code))?)(?:\s+|\n+)/i,
    "",
  );
}

function looksLikeStructuredMarkdown(s: string): boolean {
  return /^(?:#{1,6} |>|[-*] |\d+\. |```|\|)/m.test(s);
}

function prefersPlainClipboard(converted: string, plain: string): boolean {
  const want = normalizeForCompare(plain);
  if (!want) return false;
  const plainIsUrl = isPureHttpUrl(want);

  const variants: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    variants.push(t);
  };
  add(converted);
  add(stripCopyButtonMarkdown(converted));
  for (const v of [...variants]) {
    add(unwrapSelfUrlLink(v));
    // Only unwrap a wrapping fence/`span` when the clipboard is a pure URL.
    // ChatGPT/GitHub `<pre><code>` pastes must stay fenced.
    if (plainIsUrl) add(unwrapSingleWrappingCode(v));
  }

  for (const v of variants) {
    const got = normalizeForCompare(stripMarkdownBackslashEscapes(v));
    if (got === want && !looksLikeStructuredMarkdown(got)) return true;
    const noLabel = normalizeForCompare(stripCopyLabelPrefix(got));
    if (noLabel === want && !looksLikeStructuredMarkdown(noLabel)) return true;
  }
  return false;
}

function unescapeUnderscoresInHttpUrls(md: string): string {
  return md.replace(/https?:\/\/[^\s<>[\]{}]+/gi, (url) =>
    url.replace(/\\_/g, "_"),
  );
}

// Selection text that's already a markdown link — skip wrapping to avoid
// `[[old](oldurl)](newurl)` nonsense.
const ALREADY_MD_LINK_RE = /^\[[^\]]*\]\([^)]+\)$/;

/** Wrap a non-empty selection as `[sel](url)`. Returns null when wrapping would nest. */
export function wrapSelectionAsMarkdownLink(
  selText: string,
  url: string,
): string | null {
  if (!selText || ALREADY_MD_LINK_RE.test(selText)) return null;
  return `[${selText}](${url.trim()})`;
}

function insertAtCurrentSelection(view: EditorView, md: string) {
  if (!md) return;
  const { from: insFrom, to: insTo } = view.state.selection.main;
  view.dispatch({
    changes: { from: insFrom, to: insTo, insert: md },
    selection: { anchor: insFrom + md.length },
    scrollIntoView: true,
  });
}

function toastClipFailed() {
  toast({
    title: translateLoaded(detectLang(), "toast.clip_failed"),
    description: translateLoaded(detectLang(), "toast.clip_failed_desc"),
  });
}

export async function insertClippedUrl(
  view: EditorView,
  url: string,
): Promise<void> {
  const { clipUrlToMarkdown } = await import("@/lib/clip-article");
  const result = await clipUrlToMarkdown(url);
  insertAtCurrentSelection(view, result.ok ? result.markdown : result.insert);
  if (!result.ok) toastClipFailed();
}

export async function applyClipSlash(
  view: EditorView,
  from: number,
  to: number,
): Promise<void> {
  const { resolveClipUrl } = await import("@/lib/clip-article");
  const commandLine = view.state.doc.sliceString(from, to);
  let clipboardText = "";
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch {
    /* clipboard permission denied or empty */
  }
  const url = resolveClipUrl({ commandLine, clipboardText });
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    scrollIntoView: true,
  });
  if (!url) {
    toast({
      title: translateLoaded(detectLang(), "toast.clip_no_url"),
    });
    return;
  }
  await insertClippedUrl(view, url);
}

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
      const plain = clipboard.getData("text/plain");
      if (from !== to && plain && isPureHttpUrl(plain)) {
        const selText = view.state.doc.sliceString(from, to);
        const wrapped = wrapSelectionAsMarkdownLink(selText, plain);
        if (wrapped) {
          event.preventDefault();
          view.dispatch({
            changes: { from, to, insert: wrapped },
            selection: { anchor: from + wrapped.length },
            scrollIntoView: true,
          });
          return true;
        }
      }

      // Empty selection + a bare http(s) URL: fetch from this browser and
      // convert to article markdown (Readability + Turndown). Shift-paste
      // already returned false above. CORS / private-IP / non-HTML failures
      // insert the raw URL (current behavior) plus a small toast.
      if (from === to && plain && isPureHttpUrl(plain)) {
        event.preventDefault();
        void insertClippedUrl(view, plain.trim());
        return true;
      }

      const html = clipboard.getData("text/html");
      if (!html || !STRUCTURED_TAG_RE.test(html)) return false;

      // ClipboardData is only readable inside the synchronous paste handler —
      // it's cleared once the handler returns. Capture the plain-text fallback
      // now so the async catch branch still has it.
      const plainFallback = plain;

      event.preventDefault();

      // Use the live selection at dispatch time, not positions captured at
      // paste-event time: on the first structured paste turndown is fetched
      // lazily, and yjs remote edits arriving in that window would shift the
      // original from/to out from under us. CodeMirror maps selections
      // through incoming ChangeSets automatically.
      // Dynamic-import / turndown failures fall back to text/plain inside
      // markdownFromHtmlPaste so we never silently drop the paste.
      markdownFromHtmlPaste(html, plainFallback).then((md) =>
        insertAtCurrentSelection(view, md),
      );
      return true;
    },
  });
}
