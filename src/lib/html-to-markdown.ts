// Lazy Turndown (+ GFM) used by structured HTML paste and article clip.
// Loaded on first convert so Home / the initial route stay free of this graph.

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

// Turndown emits `[text](url"title")` (no space before the quote), which is
// invalid per CommonMark. Normalise to `[text](url "title")`.
export function fixTurndownLinks(md: string): string {
  return md.replace(/\]\(([^()\s"]+)"([^"]*)"\)/g, ']($1 "$2")');
}

export function unescapeUnderscoresInHttpUrls(md: string): string {
  return md.replace(/https?:\/\/[^\s<>[\]{}]+/gi, (url) =>
    url.replace(/\\_/g, "_"),
  );
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
