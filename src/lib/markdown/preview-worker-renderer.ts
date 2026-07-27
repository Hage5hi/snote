import { Marked } from "marked";

function escapeHtml(value: string): string {
  return value.replace(/[<>&]/g, (character) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;" })[character]!
  );
}

// Keep worker and offline rendering on one isolated parser configuration.
// An instance avoids mutating marked's process-wide defaults when this module
// is loaded on the main thread for the fallback path.
const markdown = new Marked({ gfm: true, breaks: true });

// Disable raw HTML parsing so stray tags in prose like `<title>` (mentioned
// as text, not as real markup) don't swallow following content. DOMPurify
// still sanitizes the final output as a safety net.
markdown.use({
  tokenizer: {
    html() { return undefined; },
  },
  extensions: [
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
  renderer: {
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
      return `<pre><code class="hljs language-${safeLanguage}" data-hljs-lang="${safeLanguage}" data-hljs-code="${encoded}">${escapeHtml(text)}</code></pre>`;
    },
  },
});

export function renderMarkdown(text: string): string {
  return markdown.parse(text) as string;
}
