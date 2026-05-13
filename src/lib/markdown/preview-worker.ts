// Web Worker entry. Receives `{ id, text }`, returns `{ id, html }` after
// running marked.parse + DOMPurify.sanitize. Custom renderer outputs
// placeholder divs for mermaid/katex/hljs blocks — main-thread hydration
// effect picks them up after setHtml.

import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

marked.setOptions({ gfm: true, breaks: true });

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

const ADD_ATTR = ["data-mermaid", "data-katex", "data-hljs-lang", "data-hljs-code"];

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
  const raw = marked.parse(text) as string;
  const html = DOMPurify.sanitize(raw, { ADD_ATTR });
  (self as unknown as Worker).postMessage({ id, html } as ResponseMessage);
};

export {};
