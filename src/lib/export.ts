import { marked } from "marked";
import DOMPurify from "dompurify";

export function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportMarkdown(slug: string, content: string) {
  downloadText(`${slug}.md`, content, "text/markdown");
}

export function exportPlainText(slug: string, content: string) {
  // Strip basic markdown for .txt export.
  const stripped = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  downloadText(`${slug}.txt`, stripped, "text/plain");
}

/** Inline CSS used by both HTML export and PDF print preview. Self-contained. */
const PRINT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.7;
    color: #1a1a1a;
    background: #fff;
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 32px;
    font-size: 15px;
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 700; line-height: 1.25; margin: 1.6em 0 0.6em; }
  h1 { font-size: 2em; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
  h3 { font-size: 1.2em; }
  p { margin: 0.8em 0; }
  a { color: #0969da; text-decoration: underline; }
  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    background: #f3f4f6; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.92em;
  }
  pre {
    background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto;
    font-size: 0.88em; line-height: 1.5;
  }
  pre code { background: transparent; padding: 0; }
  blockquote {
    border-left: 3px solid #d0d7de; color: #57606a; padding-left: 1em; margin: 1em 0;
  }
  ul, ol { padding-left: 1.6em; margin: 0.8em 0; }
  li { margin: 0.25em 0; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: 6px 12px; text-align: left; }
  th { background: #f6f8fa; }
  img { max-width: 100%; height: auto; }
  hr { border: 0; border-top: 1px solid #e5e5e5; margin: 2em 0; }
  @media print {
    body { padding: 0; max-width: none; }
    a { color: inherit; text-decoration: none; }
  }
`;

function buildHtmlDocument(title: string, markdownText: string): string {
  const rawHtml = marked.parse(markdownText, { gfm: true, breaks: true }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml);
  const safeTitle = title.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${safeHtml}
</body>
</html>`;
}

/** Standalone HTML file with inlined CSS — opens in any browser. */
export function exportHtml(slug: string, content: string) {
  const html = buildHtmlDocument(slug, content);
  downloadText(`${slug}.html`, html, "text/html");
}

/**
 * "Print to PDF" via a hidden iframe. Uses the browser's native print dialog
 * so users can choose "Save as PDF". Avoids pulling in a heavy PDF library
 * (which would add ~500KB) and produces excellent typography.
 */
export function exportPdf(slug: string, content: string) {
  const html = buildHtmlDocument(slug, content);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const cleanup = () => {
    // Give the print dialog a moment to take focus before removing.
    setTimeout(() => iframe.remove(), 1000);
  };

  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      // Guard against the initial `about:blank` load that fires before srcdoc
      // has been parsed — body would be empty and we'd print a blank page.
      if (!win || !doc || !doc.body || doc.body.children.length === 0) return;
      win.document.title = slug;
      win.focus();
      win.print();
      win.onafterprint = cleanup;
      setTimeout(cleanup, 60_000);
    } catch (e) {
      console.warn("PDF export failed", e);
      cleanup();
    }
  };

  // Set srcdoc AFTER attaching onload so we catch the real content load.
  iframe.srcdoc = html;
}
