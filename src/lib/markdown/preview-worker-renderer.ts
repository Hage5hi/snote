import { Marked, type Tokens } from "marked";
import { gfmAlertExtension } from "./gfm-alerts";
import { createPreviewHeadingIds } from "./preview-heading-id";

function escapeHtml(value: string): string {
  return value.replace(/[<>&]/g, (character) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;" })[character]!
  );
}

// Keep worker and offline rendering on one isolated parser configuration.
// An instance avoids mutating marked's process-wide defaults when this module
// is loaded on the main thread for the fallback path.
const markdown = new Marked({ gfm: true, breaks: true });

let allocateHeadingId = createPreviewHeadingIds();

// Disable raw HTML parsing so stray tags in prose like `<title>` (mentioned
// as text, not as real markup) don't swallow following content. DOMPurify
// still sanitizes the final output as a safety net.
markdown.use({
  tokenizer: {
    html() { return undefined; },
  },
  extensions: [
    gfmAlertExtension,
    {
      name: "inlineHtml",
      level: "inline",
      start(source: string) { return source.indexOf("<"); },
      tokenizer(source: string) {
        const match = /^<[^\n>]{1,200}>/.exec(source);
        if (!match) return undefined;
        return {
          type: "text",
          raw: match[0],
          text: escapeHtml(match[0]),
        };
      },
    },
  ],
});

markdown.use({
  hooks: {
    preprocess(src: string) {
      allocateHeadingId = createPreviewHeadingIds();
      return src;
    },
    postprocess(html: string) {
      return html
        .replaceAll("<table>", '<div class="md-table-wrap"><table>')
        .replaceAll("</table>", "</table></div>");
    },
  },
  renderer: {
    heading({ tokens, depth, text }: Tokens.Heading) {
      const id = allocateHeadingId(text);
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${id}" class="md-heading"><button type="button" class="md-heading-anchor" data-preview-heading="${id}"></button>${inner}</h${depth}>\n`;
    },
    code({ lang, text }: { lang?: string; text: string }) {
      const encoded = encodeURIComponent(text);
      const language = (lang || "").trim().toLowerCase();
      if (language === "mermaid") {
        return `<div class="mermaid-block my-3" data-mermaid="${encoded}"><div class="text-muted-foreground text-sm">Đang tải biểu đồ…</div></div>`;
      }
      if (language === "math" || language === "katex") {
        return `<div class="katex-block my-3" data-katex="${encoded}"><div class="text-muted-foreground text-sm">Đang tải công thức…</div></div>`;
      }
      const safeLanguage = /^[a-z0-9+#-]{1,20}$/.test(language) ? language : "";
      return `<pre class="md-code-block"><button type="button" class="md-code-copy" data-md-copy></button><code class="hljs language-${safeLanguage}" data-hljs-lang="${safeLanguage}" data-hljs-code="${encoded}">${escapeHtml(text)}</code></pre>`;
    },
  },
});

export function renderMarkdown(text: string): string {
  return markdown.parse(text) as string;
}
