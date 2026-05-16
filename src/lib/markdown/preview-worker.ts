// Web Worker entry. Receives `{ id, text }`, returns `{ id, html }` after
// running marked.parse. Sanitization (DOMPurify) runs on the main thread
// because isomorphic-dompurify needs a DOM/window which Web Workers lack
// (caused "Cannot read properties of undefined (reading 'bind')" at init).

import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

// Disable raw HTML parsing so stray tags in prose like `<title>` (mentioned
// as text, not as real markup) don't swallow following content. DOMPurify
// still sanitizes the final output as a safety net.
marked.use({
  tokenizer: {
    html() { return undefined; },
  },
  extensions: [
    {
      name: "inlineHtml",
      level: "inline",
      start(src: string) { return src.indexOf("<"); },
      tokenizer(src: string) {
        const m = /^<[^\n>]{1,200}>/.exec(src);
        if (!m) return undefined;
        return {
          type: "text",
          raw: m[0],
          text: m[0].replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!),
        };
      },
    },
  ],
});

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

marked.use({
  renderer: {
    code({ lang, text }: { lang?: string; text: string }) {
      const enc = encodeURIComponent(text);
      const l = (lang || "").trim().toLowerCase();
      if (l === "mermaid") {
        return `<div class="mermaid-block my-3" data-mermaid="${enc}"><div class="text-muted-foreground text-sm">Đang tải biểu đồ…</div></div>`;
      }
      if (l === "math" || l === "katex") {
        return `<div class="katex-block my-3" data-katex="${enc}"><div class="text-muted-foreground text-sm">Đang tải công thức…</div></div>`;
      }
      const safeLang = /^[a-z0-9+#-]{1,20}$/.test(l) ? l : "";
      return `<pre><code class="hljs language-${safeLang}" data-hljs-lang="${safeLang}" data-hljs-code="${enc}">${escapeHtml(text)}</code></pre>`;
    },
  },
});

interface RequestMessage {
  id: number;
  text: string;
}
interface ResponseMessage {
  id: number;
  html: string;
}

self.onmessage = (e: MessageEvent<RequestMessage>) => {
  const { id, text } = e.data;
  const html = marked.parse(text) as string;
  (self as unknown as Worker).postMessage({ id, html } as ResponseMessage);
};

export {};
