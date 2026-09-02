import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../preview-worker-renderer";
import { labelPreviewChrome } from "../preview-chrome";

const TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

describe("GFM GitHub alerts in preview", () => {
  it.each(TYPES)("renders a %s callout from GitHub alert syntax", (type) => {
    const html = renderMarkdown(`> [!${type}]\n> Hello ${type.toLowerCase()}`);
    const kind = type.toLowerCase();
    expect(html).toContain(`md-alert md-alert-${kind}`);
    expect(html).toContain(`data-md-alert="${kind}"`);
    expect(html).toContain(`data-md-alert-title="${kind}"`);
    expect(html).toContain(`Hello ${kind}`);
    expect(html).not.toMatch(/\[!${type}\]/);
  });

  it("accepts case-insensitive type markers like GitHub", () => {
    const html = renderMarkdown("> [!tip]\n> Drink water");
    expect(html).toContain('data-md-alert="tip"');
    expect(html).toContain("Drink water");
  });

  it("keeps a following paragraph out of the alert when a blank line ends it", () => {
    const html = renderMarkdown("> [!NOTE]\n> Inside\n\nOutside");
    expect(html).toMatch(/md-alert[\s\S]*Inside/);
    expect(html).toMatch(/<p>Outside<\/p>/);
    const outsideIndex = html.indexOf("<p>Outside</p>");
    const alertClose = html.lastIndexOf("md-alert");
    expect(outsideIndex).toBeGreaterThan(alertClose);
  });

  it("does not treat Obsidian fold markers as GitHub alerts", () => {
    const plus = renderMarkdown("> [!NOTE]+\n> Folded open");
    const minus = renderMarkdown("> [!NOTE]-\n> Folded shut");
    expect(plus).not.toContain("md-alert");
    expect(minus).not.toContain("md-alert");
    expect(plus).toContain("[!NOTE]+");
    expect(minus).toContain("[!NOTE]-");
  });

  it("does not treat a custom title on the marker line as a GitHub alert", () => {
    const html = renderMarkdown("> [!NOTE] Custom title\n> Body");
    expect(html).not.toContain("md-alert");
    expect(html).toContain("[!NOTE] Custom title");
  });

  it("still renders a normal blockquote that is not an alert", () => {
    const html = renderMarkdown("> just a quote");
    expect(html).not.toContain("md-alert");
    expect(html).toMatch(/<blockquote>/);
  });

  it("renders markdown inside the alert body", () => {
    const html = renderMarkdown("> [!WARNING]\n> **bold** and `code`");
    expect(html).toContain("md-alert-warning");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("fills i18n titles onto alert chrome without using English as the only label", () => {
    document.body.innerHTML = renderMarkdown("> [!IMPORTANT]\n> Key fact");
    const host = document.body;
    labelPreviewChrome(host, "Copy", "Jump", {
      note: "Ghi chú",
      tip: "Mẹo",
      important: "Quan trọng",
      warning: "Cảnh báo",
      caution: "Thận trọng",
    });
    expect(host.querySelector("[data-md-alert-title='important']")).toHaveTextContent("Quan trọng");
  });

  it("keeps alert data attributes after DOMPurify", async () => {
    const { renderOnMainThread } = await import("../preview-worker-client");
    const html = await renderOnMainThread("> [!NOTE]\n> Hello");
    expect(html).toContain('data-md-alert="note"');
    expect(html).toContain('data-md-alert-title="note"');
    expect(html).toContain("Hello");
  });
});
