import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../preview-worker-renderer";
import { createPreviewHeadingIds } from "../preview-heading-id";

const INDEX_CSS = resolve(__dirname, "../../../index.css");

const SEMANTIC_QA_TABLE = `## Báo cáo thống kê phân loại Semantic QA (Semantic Audit Summary)

| Phân loại | Số lượng dòng | Tỷ lệ | Ghi chú |
| --- | ---: | ---: | --- |
| \`translated_real\` (\`s001\`) | 42.661 | 100% | (\`intentional_keep_english\`) |
| \`unexplained_exact_residual\` | 36.735 | 86.1% | \`prefixed_fallback\` |
| Thiếu văn bản nguồn (\`source\`) | 4.635 | 10.9% | \`PASSED\` |
`;

function declarationsFor(css: string, needle: string): string[] {
  const bodies: string[] = [];
  const re = /([^{}@][^{]*)\{([^}]*)\}/g;
  for (const match of css.matchAll(re)) {
    const selectors = match[1].split(",").map((part) => part.trim().replace(/\s+/g, " "));
    if (selectors.some((selector) => selector === needle || selector.endsWith(" " + needle))) {
      bodies.push(match[2]);
    }
  }
  return bodies;
}

describe("preview heading ids", () => {
  it("never emits reserved capability/encryption fragment ids", () => {
    const next = createPreviewHeadingIds();
    for (const text of ["Owner", "edit", "key", "KEY"]) {
      const id = next(text);
      expect(["owner", "edit", "key"]).not.toContain(id);
      expect(id).toMatch(/^preview-h-/);
    }
  });
});

describe("preview markdown tables", () => {
  it("wraps the Semantic QA fixture in a horizontal-scroll container", () => {
    const html = renderMarkdown(SEMANTIC_QA_TABLE);
    expect(html).toContain('class="md-table-wrap"');
    expect(html).toMatch(/<div class="md-table-wrap"><table>[\s\S]*42\.661[\s\S]*<\/table><\/div>/);
    expect(html).toContain("translated_real");
    expect(html).toContain("<thead>");
  });

  it("does not apply overflow-wrap:anywhere to table cells", () => {
    const css = readFileSync(INDEX_CSS, "utf8");
    const start = css.indexOf("/* ================== Markdown preview tables");
    expect(start).toBeGreaterThanOrEqual(0);
    const tableCss = css.slice(start);

    const wrap = declarationsFor(tableCss, ".markdown-preview .md-table-wrap").join("\n");
    expect(wrap).toMatch(/overflow-x:\s*auto/);
    expect(wrap).not.toMatch(/overflow-wrap:\s*anywhere/);

    const cells = [
      ...declarationsFor(tableCss, ".markdown-preview .md-table-wrap td"),
      ...declarationsFor(tableCss, ".markdown-preview .md-table-wrap th"),
      ...declarationsFor(tableCss, ".markdown-preview .md-table-wrap th, .markdown-preview .md-table-wrap td"),
    ].join("\n");
    expect(cells.length).toBeGreaterThan(0);
    expect(cells).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(cells).toMatch(/overflow-wrap:\s*break-word/);
    expect(cells).toMatch(/word-break:\s*normal/);
  });

  it("keeps mermaid/katex/wiki-style links and disabled task checkboxes", () => {
    const html = renderMarkdown([
      "[note](/daily)",
      "",
      "```mermaid",
      "graph TD",
      "```",
      "",
      "```katex",
      "x^2",
      "```",
      "",
      "- [ ] open task",
      "- [x] done task",
    ].join("\n"));

    expect(html).toContain('href="/daily"');
    expect(html).toContain('data-mermaid="graph%20TD"');
    expect(html).toContain("data-katex=");
    const checkboxes = html.match(/<input\b[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(checkboxes.length).toBe(2);
    expect(checkboxes.every((tag) => tag.includes("disabled"))).toBe(true);
  });

  it("adds copy buttons on fenced code and heading anchors without reserved ids", () => {
    const html = renderMarkdown("# Owner\n\n```js\nconst n = 42.661;\n```\n");
    expect(html).toContain('id="preview-h-owner"');
    expect(html).not.toMatch(/id="owner"/);
    expect(html).toContain('data-preview-heading="preview-h-owner"');
    expect(html).toContain('data-md-copy');
    expect(html).toContain("const n = 42.661;");
  });
});
