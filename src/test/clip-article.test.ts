import { describe, it, expect, vi, afterEach } from "vitest";
import { dict } from "@/i18n/catalog";
import { SUPPORTED_LANGS } from "@/i18n";
import {
  clipUrlToMarkdown,
  htmlToArticleMarkdown,
  isUnsafeClipUrl,
  resolveClipUrl,
} from "@/lib/clip-article";

function articleHtml(opts: {
  title: string;
  body: string;
  extra?: string;
}): string {
  return `<!doctype html>
<html>
<head><title>${opts.title}</title></head>
<body>
  <nav>Site chrome that should be stripped</nav>
  <article>
    <h1>${opts.title}</h1>
    ${opts.body}
  </article>
  ${opts.extra ?? ""}
  <footer>Related ads</footer>
</body>
</html>`;
}

const BODY_PARAGRAPH =
  "<p>" +
  "The river wound through the valley for many miles, carrying silt and stories from the high country. ".repeat(
    8,
  ) +
  'See also <a href="https://cdn.example.com/path_with_underscore">https://cdn.example.com/path_with_underscore</a>.' +
  "</p>";

describe("htmlToArticleMarkdown", () => {
  it("converts article HTML to markdown with a title heading and source link", async () => {
    const url = "https://example.com/posts/hello";
    const html = articleHtml({
      title: "Clean Article Title",
      body: BODY_PARAGRAPH,
    });
    const md = await htmlToArticleMarkdown(html, url);
    expect(md).toMatch(/^# Clean Article Title/m);
    expect(md).toContain(`[${url}](${url})`);
    expect(md).toMatch(/river wound through the valley/i);
    expect(md).not.toMatch(/Site chrome that should be stripped/);
  });

  it("unescapes underscores inside http(s) URLs in the converted article", async () => {
    const url = "https://example.com/source";
    const html = articleHtml({
      title: "Underscore URL",
      body: BODY_PARAGRAPH,
    });
    const md = await htmlToArticleMarkdown(html, url);
    expect(md).toContain("https://cdn.example.com/path_with_underscore");
    expect(md).not.toMatch(/path\\_with\\_underscore/);
  });

  it("fails closed to a markdown link when HTML is empty", async () => {
    const url = "https://example.com/empty";
    const md = await htmlToArticleMarkdown("   ", url);
    expect(md).toBe(`[${url}](${url})`);
  });

  it("fails closed to a markdown link when HTML exceeds the size cap", async () => {
    const url = "https://example.com/huge";
    const huge = `<html><body><p>${"word ".repeat(50)}</p></body></html>`;
    const md = await htmlToArticleMarkdown(huge, url, { maxHtmlChars: 32 });
    expect(md).toBe(`[${url}](${url})`);
  });
});

describe("isUnsafeClipUrl", () => {
  it("blocks localhost, RFC1918, link-local, and metadata targets", () => {
    const blocked = [
      "http://localhost/x",
      "https://127.0.0.1/",
      "http://[::1]/",
      "http://10.0.0.5/secret",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://172.31.255.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.1.1/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "https://metadata.google.internal/",
      "http://100.100.100.200/",
    ];
    for (const url of blocked) {
      expect(isUnsafeClipUrl(url), url).toBe(true);
    }
  });

  it("allows ordinary public http(s) URLs", () => {
    expect(isUnsafeClipUrl("https://example.com/a_b")).toBe(false);
    expect(isUnsafeClipUrl("http://example.com/page")).toBe(false);
    expect(isUnsafeClipUrl("https://172.32.0.1/")).toBe(false);
    expect(isUnsafeClipUrl("https://172.15.0.1/")).toBe(false);
  });

  it("blocks WHATWG-canonicalized IPv4-mapped loopback and localhost.", () => {
    expect(isUnsafeClipUrl("http://[::ffff:127.0.0.1]/")).toBe(true);
    expect(isUnsafeClipUrl("http://[::ffff:7f00:1]/")).toBe(true);
    expect(isUnsafeClipUrl("http://localhost./x")).toBe(true);
    expect(isUnsafeClipUrl("http://[::ffff:169.254.169.254]/")).toBe(true);
    expect(isUnsafeClipUrl("http://[::]/")).toBe(true);
  });
});

function htmlResponse(html: string, init?: { url?: string; type?: string }): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": init?.type ?? "text/html; charset=utf-8" },
  });
}

describe("clipUrlToMarkdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches HTML and returns article markdown", async () => {
    const url = "https://example.com/posts/hello";
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        htmlResponse(articleHtml({ title: "Fetched Title", body: BODY_PARAGRAPH })),
    );
    const result = await clipUrlToMarkdown(url, { fetch: fetchMock });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toMatch(/^# Fetched Title/m);
      expect(result.markdown).toContain(`[${url}](${url})`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    expect(call[1]?.credentials).toBe("omit");
  });

  it("inserts the raw URL when the target is private", async () => {
    const url = "http://127.0.0.1/admin";
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    const result = await clipUrlToMarkdown(url, { fetch: fetchMock });
    expect(result).toEqual({
      ok: false,
      insert: url,
      reason: "blocked",
      toast: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("inserts the raw URL when fetch fails (CORS)", async () => {
    const url = "https://example.com/cors";
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => {
        throw new TypeError("Failed to fetch");
      },
    );
    const result = await clipUrlToMarkdown(url, { fetch: fetchMock });
    expect(result).toEqual({
      ok: false,
      insert: url,
      reason: "fetch",
      toast: true,
    });
  });

  it("inserts the raw URL for non-HTML responses", async () => {
    const url = "https://example.com/data.json";
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await clipUrlToMarkdown(url, { fetch: fetchMock });
    expect(result).toEqual({
      ok: false,
      insert: url,
      reason: "non_html",
      toast: true,
    });
  });

  it("fails with too_large when the HTML body exceeds the cap", async () => {
    const url = "https://example.com/huge";
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response("x".repeat(200), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const result = await clipUrlToMarkdown(url, {
      fetch: fetchMock,
      maxHtmlChars: 32,
    });
    expect(result).toEqual({
      ok: false,
      insert: url,
      reason: "too_large",
      toast: true,
    });
  });
});

describe("resolveClipUrl", () => {
  it("prefers a URL argument after /clip", () => {
    expect(
      resolveClipUrl({
        commandLine: "/clip https://example.com/a_b",
        clipboardText: "https://other.example/x",
      }),
    ).toBe("https://example.com/a_b");
  });

  it("uses the nearest URL on the command line", () => {
    expect(
      resolveClipUrl({
        commandLine: "/clip see https://example.com/nearest",
        clipboardText: "",
      }),
    ).toBe("https://example.com/nearest");
  });

  it("falls back to a pure clipboard URL", () => {
    expect(
      resolveClipUrl({
        commandLine: "/clip",
        clipboardText: "  https://example.com/from_clipboard  ",
      }),
    ).toBe("https://example.com/from_clipboard");
  });

  it("returns null when nothing is a URL", () => {
    expect(resolveClipUrl({ commandLine: "/clip", clipboardText: "hello" })).toBeNull();
  });
});

describe("clip i18n", () => {
  it("has slash and toast keys in all 9 locales", () => {
    const keys = [
      "slash.detail.clip",
      "toast.clip_failed",
      "toast.clip_failed_desc",
      "toast.clip_no_url",
    ] as const;
    for (const lang of SUPPORTED_LANGS) {
      for (const key of keys) {
        expect(dict[lang][key].trim().length).toBeGreaterThan(0);
      }
    }
  });
});
