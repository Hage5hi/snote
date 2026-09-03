import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fixTurndownLinks,
  isPureHttpUrl,
  markdownFromHtmlPaste,
  pasteMarkdown,
  wrapSelectionAsMarkdownLink,
} from "@/lib/paste-markdown";

/** Synthetic clipboard payload — do not use real tokens from bug reports. */
const SYNTHETIC_URL =
  "https://example.com/subscription/new/AQCpiIF97V3_ueoQ3Rm5Q_foo==";
const SYNTHETIC_TOKEN = "tok_AQCpiIF97V3_ueoQ3Rm5Q_foo==";
const SYNTHETIC_PLAIN = `${SYNTHETIC_TOKEN}\n1234567890 |\n${SYNTHETIC_URL}`;

describe("fixTurndownLinks", () => {
  it("inserts a space between URL and title when missing", () => {
    const input = '[foo](https://example.com"Foo")';
    expect(fixTurndownLinks(input)).toBe('[foo](https://example.com "Foo")');
  });

  it("is idempotent when space is already present", () => {
    const input = '[foo](https://example.com "Foo")';
    expect(fixTurndownLinks(input)).toBe(input);
  });

  it("leaves titleless links untouched", () => {
    const input = "[foo](https://example.com)";
    expect(fixTurndownLinks(input)).toBe(input);
  });

  it("fixes multiple links in the same document", () => {
    const input =
      '[a](https://a.example"A") and [b](https://b.example"B")';
    expect(fixTurndownLinks(input)).toBe(
      '[a](https://a.example "A") and [b](https://b.example "B")',
    );
  });

  it("handles URLs with fragments and query strings", () => {
    const input = '[sec](https://example.com/page?x=1#s"Section")';
    expect(fixTurndownLinks(input)).toBe(
      '[sec](https://example.com/page?x=1#s "Section")',
    );
  });

  it("handles empty title string", () => {
    const input = '[x](https://example.com"")';
    expect(fixTurndownLinks(input)).toBe('[x](https://example.com "")');
  });
});

describe("isPureHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isPureHttpUrl("http://example.com")).toBe(true);
    expect(isPureHttpUrl("https://example.com")).toBe(true);
    expect(isPureHttpUrl("https://a.b/c?d=1#e")).toBe(true);
  });

  it("trims leading/trailing whitespace", () => {
    expect(isPureHttpUrl("  https://example.com  ")).toBe(true);
    expect(isPureHttpUrl("\nhttps://example.com\n")).toBe(true);
  });

  it("rejects text that isn't a URL", () => {
    expect(isPureHttpUrl("hello world")).toBe(false);
    expect(isPureHttpUrl("")).toBe(false);
    expect(isPureHttpUrl("example.com")).toBe(false);
  });

  it("rejects URLs with surrounding text", () => {
    expect(isPureHttpUrl("see https://example.com today")).toBe(false);
    expect(isPureHttpUrl("https://example.com and more")).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(isPureHttpUrl("ftp://example.com")).toBe(false);
    expect(isPureHttpUrl("mailto:a@b.c")).toBe(false);
    expect(isPureHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isPureHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects www without scheme", () => {
    expect(isPureHttpUrl("www.example.com")).toBe(false);
  });
});

describe("wrapSelectionAsMarkdownLink", () => {
  it("wraps a selected range as [sel](url)", () => {
    expect(wrapSelectionAsMarkdownLink("sel", "https://example.com/a_b")).toBe(
      "[sel](https://example.com/a_b)",
    );
  });

  it("does not wrap an existing markdown link", () => {
    expect(
      wrapSelectionAsMarkdownLink("[old](https://old.example)", "https://new.example"),
    ).toBeNull();
  });

  it("does not wrap an empty selection", () => {
    expect(wrapSelectionAsMarkdownLink("", "https://example.com")).toBeNull();
  });
});

describe("markdownFromHtmlPaste", () => {
  it("keeps underscores when a copy-button <a> wraps a token and URL", async () => {
    const html = `<html><body><!--StartFragment--><div><a href="#">copy</a><div>${SYNTHETIC_TOKEN}<br>1234567890 |<br>${SYNTHETIC_URL}</div></div><!--EndFragment--></body></html>`;
    const md = await markdownFromHtmlPaste(html, SYNTHETIC_PLAIN);
    expect(md).toBe(SYNTHETIC_PLAIN);
    expect(md).not.toMatch(/\\_/);
  });

  it("keeps underscores for a <pre>-wrapped URL with _", async () => {
    const html = `<pre>${SYNTHETIC_URL}</pre>`;
    const md = await markdownFromHtmlPaste(html, SYNTHETIC_URL);
    expect(md).toBe(SYNTHETIC_URL);
    expect(md).not.toMatch(/\\_/);
  });

  it("keeps underscores for a <pre><code> copy-box URL", async () => {
    const html = `<pre><code>${SYNTHETIC_URL}</code></pre>`;
    const md = await markdownFromHtmlPaste(html, SYNTHETIC_URL);
    expect(md).toBe(SYNTHETIC_URL);
    expect(md).not.toMatch(/\\_/);
  });

  it("keeps underscores for an inline <code> URL", async () => {
    const html = `<p><code>${SYNTHETIC_URL}</code></p>`;
    const md = await markdownFromHtmlPaste(html, SYNTHETIC_URL);
    expect(md).toBe(SYNTHETIC_URL);
    expect(md).not.toMatch(/\\_/);
  });

  it("inserts the raw URL for a single <a href=url>url</a> clipboard", async () => {
    const html = `<a href="${SYNTHETIC_URL}">${SYNTHETIC_URL}</a>`;
    const md = await markdownFromHtmlPaste(html, SYNTHETIC_URL);
    expect(md).toBe(SYNTHETIC_URL);
    expect(md).not.toMatch(/\\_/);
  });

  it("strips copy-button chrome around a self-href URL", async () => {
    const html = `<div class="copy"><a href="#" aria-label="copy to clipboard">copy</a><a href="${SYNTHETIC_URL}">${SYNTHETIC_URL}</a></div>`;
    const md = await markdownFromHtmlPaste(html, SYNTHETIC_URL);
    expect(md).toBe(SYNTHETIC_URL);
    expect(md).not.toMatch(/\\_/);
  });

  it("still converts a real list and strong HTML paste to markdown", async () => {
    const html = `<ul><li>one</li><li><strong>two</strong></li></ul>`;
    const plain = "one\ntwo";
    const md = await markdownFromHtmlPaste(html, plain);
    expect(md).toMatch(/^- {1,3}one/m);
    expect(md).toMatch(/\*\*two\*\*/);
    expect(md).not.toBe(plain);
  });

  it("still converts emphasis rather than collapsing to plain", async () => {
    const html = `<p>hello <em>world</em></p>`;
    const md = await markdownFromHtmlPaste(html, "hello world");
    expect(md).toBe("hello _world_");
  });

  it("still escapes underscores next to real emphasis so they are not italics", async () => {
    const html = `<p>foo_bar and <em>baz</em></p>`;
    const md = await markdownFromHtmlPaste(html, "foo_bar and baz");
    expect(md).toBe("foo\\_bar and _baz_");
  });

  it("unescapes underscores inside http(s) URLs in otherwise rich markdown", async () => {
    const html = `<ul><li>See ${SYNTHETIC_URL}</li></ul>`;
    const plain = `See ${SYNTHETIC_URL}`;
    const md = await markdownFromHtmlPaste(html, plain);
    expect(md).toMatch(/^- {1,3}See /);
    expect(md).toContain(SYNTHETIC_URL);
    expect(md).not.toMatch(/\\_/);
  });

  it("keeps a fenced code block of markdown-looking source", async () => {
    const source = "# heading\nfoo_bar = 1\n*not italic*";
    const html = `<pre><code>${source}</code></pre>`;
    const md = await markdownFromHtmlPaste(html, source);
    expect(md).toMatch(/^```/);
    expect(md).toContain(source);
    expect(md).not.toBe(source);
  });

  it("keeps a ChatGPT-style copy button plus a list as markdown", async () => {
    const html = `<div><a href="#">Copy code</a><ul><li>one</li><li><strong>two</strong></li></ul></div>`;
    const md = await markdownFromHtmlPaste(html, "Copy code\none\ntwo");
    expect(md).toMatch(/^- {1,3}one/m);
    expect(md).toMatch(/\*\*two\*\*/);
  });

  it("does not turn a bare <pre> of markdown source into live markup", async () => {
    const source = "# heading\nfoo_bar";
    const html = `<pre>${source}</pre>`;
    const md = await markdownFromHtmlPaste(html, source);
    expect(md).not.toBe(source);
    expect(md.startsWith("# ")).toBe(false);
  });
});

function dispatchPaste(
  view: EditorView,
  { plain, html, shiftKey = false }: { plain: string; html?: string; shiftKey?: boolean },
) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "shiftKey", { value: shiftKey });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => {
        if (type === "text/plain") return plain;
        if (type === "text/html") return html ?? "";
        return "";
      },
    },
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe("pasteMarkdown URL wrap vs clip", () => {
  beforeEach(() => {
    Range.prototype.getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
    Range.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON() {
          return this;
        },
      };
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("wraps a selection as a markdown link and does not fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello",
        extensions: [pasteMarkdown()],
      }),
      parent,
    });
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    const event = dispatchPaste(view, { plain: "https://example.com/a_b" });
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("[hello](https://example.com/a_b)");
    expect(fetchMock).not.toHaveBeenCalled();
    view.destroy();
  });

  it("clips an empty-selection URL paste via fetch and inserts article markdown", async () => {
    const url = "https://example.com/posts/hello";
    const body =
      "<p>" +
      "The river wound through the valley for many miles, carrying silt and stories from the high country. ".repeat(
        8,
      ) +
      "</p>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          `<!doctype html><html><head><title>Fetched Title</title></head><body><article><h1>Fetched Title</h1>${body}</article></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [pasteMarkdown()],
      }),
      parent,
    });
    const event = dispatchPaste(view, { plain: url });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toMatch(/^# Fetched Title/m);
    });
    expect(view.state.doc.toString()).toContain(`[${url}](${url})`);
    view.destroy();
  });

  it("inserts the raw URL and does not hang when clip fetch fails", async () => {
    const url = "https://example.com/cors";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [pasteMarkdown()],
      }),
      parent,
    });
    dispatchPaste(view, { plain: url });
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe(url);
    });
    view.destroy();
  });

  it("leaves Shift-paste as a raw URL without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [pasteMarkdown()],
      }),
      parent,
    });
    dispatchPaste(view, {
      plain: "https://example.com/a_b",
      shiftKey: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("https://example.com/a_b");
    view.destroy();
  });
});
