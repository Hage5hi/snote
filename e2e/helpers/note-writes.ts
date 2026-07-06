// Shared helpers for intercepting mutating writes to the notes REST endpoint
// from both the fetch path (Supabase-js) and the sendBeacon fallback (unload
// flush). Normalises URLs so trivial querystring / trailing-slash differences
// don't cause flaky assertions across browsers.
//
// Also provides a unique-slug helper so seeded notes never collide across
// parallel CI jobs / matrix workers.

import type { Page, Request } from "@playwright/test";

export type NoteWrite = { source: string; method: string; url: string };

const MUTATING = new Set(["PATCH", "POST", "PUT", "DELETE"]);

/** Strip query, hash, trailing slash — only path identity matters for matching. */
export function normalizeNoteUrl(raw: string): string {
  try {
    const u = new URL(raw, "http://localhost");
    return u.pathname.replace(/\/+$/, "");
  } catch {
    return raw.split("?")[0].split("#")[0].replace(/\/+$/, "");
  }
}

/** True if the URL targets the notes REST endpoint (any browser / origin). */
export function isNotesUrl(raw: string): boolean {
  return /\/rest\/v1\/notes(?:$|[/?])/.test(normalizeNoteUrl(raw) + (raw.includes("?") ? "?" : ""))
    || /\/rest\/v1\/notes\b/.test(raw);
}

export function isNoteWriteRequest(method: string, url: string): boolean {
  return MUTATING.has(method.toUpperCase()) && isNotesUrl(url);
}

/**
 * Install both a Playwright network listener AND an in-page fetch/sendBeacon
 * wrapper. Returns a getter that merges both sources into a single ordered
 * list. Call BEFORE `page.goto(...)` so the init script is present at load.
 */
export async function trackNoteWrites(page: Page): Promise<() => Promise<NoteWrite[]>> {
  const networkWrites: NoteWrite[] = [];

  page.on("request", (req: Request) => {
    if (isNoteWriteRequest(req.method(), req.url())) {
      networkWrites.push({ source: "network", method: req.method(), url: normalizeNoteUrl(req.url()) });
    }
  });

  await page.addInitScript(() => {
    const w = window as unknown as { __noteWrites: NoteWrite[] };
    w.__noteWrites = [];
    const norm = (u: string) => {
      try {
        return new URL(u, location.href).pathname.replace(/\/+$/, "");
      } catch {
        return u.split("?")[0].split("#")[0].replace(/\/+$/, "");
      }
    };
    const isNote = (u: string) => /\/rest\/v1\/notes\b/.test(u);
    const MUT = new Set(["PATCH", "POST", "PUT", "DELETE"]);

    const origBeacon = navigator.sendBeacon?.bind(navigator);
    if (origBeacon) {
      navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
        const u = String(url);
        if (isNote(u)) w.__noteWrites.push({ source: "beacon", method: "POST", url: norm(u) });
        return origBeacon(url, data);
      };
    }
    const origFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const method = (
        init?.method || (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (isNote(url) && MUT.has(method)) {
        w.__noteWrites.push({ source: "fetch-wrap", method, url: norm(url) });
      }
      return origFetch(input as RequestInfo, init);
    };
  });

  return async () => {
    const inPage = await page.evaluate(
      () => (window as unknown as { __noteWrites: NoteWrite[] }).__noteWrites,
    );
    return [...networkWrites, ...inPage];
  };
}

/**
 * Deterministically-unique slug per test run. Includes:
 *   - a `tag` (spec-scoped identifier),
 *   - a monotonically increasing counter (per-process),
 *   - a Playwright worker index (per parallel CI shard),
 *   - a timestamp + random suffix (across-run collision guard).
 */
let __slugCounter = 0;
export function uniqueSlug(tag: string): string {
  __slugCounter += 1;
  const worker = process.env.TEST_WORKER_INDEX ?? "0";
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-${tag}-w${worker}-n${__slugCounter}-${ts}-${rand}`;
}
