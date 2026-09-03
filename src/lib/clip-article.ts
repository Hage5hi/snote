// Clip a page the user already has a URL for into local article markdown.
// Fetch runs in *this* browser with credentials omitted. There is no Worker
// proxy and no TinyFish / Firecrawl / Jina (or other) extract API — most
// third-party HTML is blocked by CORS, and that failure is expected: we
// insert the raw URL and toast instead of hanging the editor.

import { EditorView } from "@codemirror/view";
import { toast } from "@/hooks/use-toast";
import { detectLang, translateLoaded } from "@/i18n";
import { isPureHttpUrl } from "@/lib/paste-markdown";

export const CLIP_MAX_HTML_CHARS = 1_000_000;
export const CLIP_FETCH_TIMEOUT_MS = 8_000;

export type ClipFailReason = "blocked" | "fetch" | "non_html" | "timeout" | "too_large";

export type ClipResult =
  | { ok: true; markdown: string }
  | { ok: false; insert: string; reason: ClipFailReason; toast: true };

type ClipFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const HTTP_URL_IN_TEXT = /https?:\/\/[^\s<>[\]{}]+/i;

function failClosedLink(sourceUrl: string): string {
  return `[${sourceUrl}](${sourceUrl})`;
}

function ipv4ToInt(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = ((n << 8) | octet) >>> 0;
  }
  return n;
}

function isBlockedIpv4(n: number): boolean {
  const a = (n >>> 24) & 0xff;
  const b = (n >>> 16) & 0xff;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Alibaba cloud metadata
  if (a === 100 && b === 100 && ((n >>> 8) & 0xff) === 100 && (n & 0xff) === 200) {
    return true;
  }
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const n = ipv4ToInt(mapped[1]);
    return n !== null && isBlockedIpv4(n);
  }
  const hextets = h.split(":");
  const first = parseInt(hextets[0] || "0", 16);
  if (!Number.isFinite(first)) return false;
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) return true;
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  const v4 = ipv4ToInt(host);
  if (v4 !== null) return isBlockedIpv4(v4);
  if (host.includes(":")) return isBlockedIpv6(host);
  return false;
}

/** True when we must not fetch this URL (SSRF / loopback / metadata). */
export function isUnsafeClipUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return true;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return true;
  if (url.username || url.password) return true;
  return isBlockedHost(url.hostname);
}

export function extractNearestHttpUrl(text: string): string | null {
  const match = text.match(HTTP_URL_IN_TEXT);
  if (!match) return null;
  const url = match[0].replace(/[.,);]+$/g, "");
  return isPureHttpUrl(url) ? url.trim() : null;
}

export function resolveClipUrl(args: {
  commandLine: string;
  clipboardText?: string;
}): string | null {
  const after = args.commandLine.replace(/^\/clip\b/i, "");
  const fromArg = extractNearestHttpUrl(after);
  if (fromArg) return fromArg;
  const fromLine = extractNearestHttpUrl(args.commandLine);
  if (fromLine) return fromLine;
  const clip = (args.clipboardText ?? "").trim();
  return isPureHttpUrl(clip) ? clip : null;
}

function abortTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function isHtmlContentType(ct: string): boolean {
  return /text\/html|application\/xhtml\+xml/i.test(ct);
}

function looksLikeHtml(html: string): boolean {
  return /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(html);
}

async function readTextCapped(
  response: Response,
  maxChars: number,
): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxChars) return null;
  const text = await response.text();
  if (text.length > maxChars) return null;
  return text;
}

let readabilityPromise: Promise<typeof import("@mozilla/readability")> | null =
  null;

function loadReadability(): Promise<typeof import("@mozilla/readability")> {
  if (!readabilityPromise) {
    const pending = import("@mozilla/readability");
    pending.catch(() => {
      if (readabilityPromise === pending) readabilityPromise = null;
    });
    readabilityPromise = pending;
  }
  return readabilityPromise;
}

function parseHtmlDocument(html: string, sourceUrl: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = doc.createElement("base");
  base.setAttribute("href", sourceUrl);
  doc.head.insertBefore(base, doc.head.firstChild);
  return doc;
}

/**
 * HTML (or an already-fetched document) → article markdown.
 * Always returns a string; conversion failure is `[url](url)`.
 */
export async function htmlToArticleMarkdown(
  html: string,
  sourceUrl: string,
  opts?: { maxHtmlChars?: number },
): Promise<string> {
  const link = failClosedLink(sourceUrl);
  const maxHtmlChars = opts?.maxHtmlChars ?? CLIP_MAX_HTML_CHARS;
  try {
    if (!html.trim() || html.length > maxHtmlChars) return link;
    const { htmlToMarkdown } = await import("@/lib/paste-markdown");
    const doc = parseHtmlDocument(html, sourceUrl);
    let contentHtml = "";
    let title = (doc.title || "").replace(/\s+/g, " ").trim();
    try {
      const { Readability } = await loadReadability();
      const article = new Readability(doc.cloneNode(true) as Document, {
        charThreshold: 140,
      }).parse();
      if (article?.title) title = article.title.replace(/\s+/g, " ").trim();
      contentHtml = article?.content?.trim() ?? "";
    } catch {
      contentHtml = "";
    }
    if (!contentHtml) contentHtml = doc.body?.innerHTML ?? html;
    const body = (await htmlToMarkdown(contentHtml)).trim();
    if (!body) return link;
    const parts: string[] = [];
    if (title) parts.push(`# ${title}`);
    parts.push(link);
    parts.push(body);
    return parts.join("\n\n");
  } catch {
    return link;
  }
}

function fail(url: string, reason: ClipFailReason): ClipResult {
  return { ok: false, insert: url, reason, toast: true };
}

export async function clipUrlToMarkdown(
  rawUrl: string,
  opts?: {
    fetch?: ClipFetch;
    timeoutMs?: number;
    maxHtmlChars?: number;
  },
): Promise<ClipResult> {
  const url = rawUrl.trim();
  if (isUnsafeClipUrl(url)) return fail(url, "blocked");

  const fetchImpl = opts?.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts?.timeoutMs ?? CLIP_FETCH_TIMEOUT_MS;
  const maxHtmlChars = opts?.maxHtmlChars ?? CLIP_MAX_HTML_CHARS;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      credentials: "omit",
      mode: "cors",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: abortTimeout(timeoutMs),
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return fail(url, "timeout");
    }
    return fail(url, "fetch");
  }

  if (!response.ok) return fail(url, "fetch");
  if (response.url && isUnsafeClipUrl(response.url)) return fail(url, "blocked");

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !isHtmlContentType(contentType)) {
    return fail(url, "non_html");
  }

  let html: string | null;
  try {
    html = await readTextCapped(response, maxHtmlChars);
  } catch {
    return fail(url, "fetch");
  }
  if (html === null) return fail(url, "too_large");
  if (!contentType && !looksLikeHtml(html)) return fail(url, "non_html");

  const markdown = await htmlToArticleMarkdown(html, response.url || url, {
    maxHtmlChars,
  });
  return { ok: true, markdown };
}

function insertAtSelection(view: EditorView, text: string) {
  if (!text) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  });
}

function toastClipFailed() {
  toast({
    title: translateLoaded(detectLang(), "toast.clip_failed"),
    description: translateLoaded(detectLang(), "toast.clip_failed_desc"),
  });
}

export async function insertClippedUrl(
  view: EditorView,
  url: string,
): Promise<void> {
  const result = await clipUrlToMarkdown(url);
  insertAtSelection(view, result.ok ? result.markdown : result.insert);
  if (!result.ok) toastClipFailed();
}

export async function applyClipSlash(
  view: EditorView,
  from: number,
  to: number,
): Promise<void> {
  const commandLine = view.state.doc.sliceString(from, to);
  let clipboardText = "";
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch {
    /* clipboard permission denied or empty */
  }
  const url = resolveClipUrl({ commandLine, clipboardText });
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    scrollIntoView: true,
  });
  if (!url) {
    toast({
      title: translateLoaded(detectLang(), "toast.clip_no_url"),
    });
    return;
  }
  await insertClippedUrl(view, url);
}
