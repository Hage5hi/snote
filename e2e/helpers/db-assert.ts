// Shared DB assertion helpers for E2E specs that need to poll the notes
// table across the Yjs debounce/finalize window (rename race, snapshot
// resurrection, etc.). Uses the anon key — same client seed helpers use.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page, TestInfo } from "@playwright/test";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (needed for E2E DB assertions).`);
  return v;
}

let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (!_client) {
    _client = createClient(env("VITE_SUPABASE_URL"), env("VITE_SUPABASE_PUBLISHABLE_KEY"));
  }
  return _client;
}

export type NoteRowSnapshot = {
  slug: string;
  char_count: number | null;
  updated_at: string | null;
  ydoc_state_len: number;
  content_len: number;
} | null;

export type OldSlugCleanupStatus = {
  slug: string;
  source: "edge-function" | "direct-db-fallback";
  database: {
    rowPresent: boolean;
    row: NoteRowSnapshot;
  };
  clientSignals: Record<string, unknown>;
  cleaned: boolean;
};

/** One-shot fetch of the row (or null) with size-only fields — safe to log. */
export async function snapshotSlugRow(slug: string): Promise<NoteRowSnapshot> {
  const { data, error } = await client()
    .from("notes")
    .select("slug, char_count, updated_at, ydoc_state, content")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    slug: data.slug,
    char_count: data.char_count ?? null,
    updated_at: (data as { updated_at?: string | null }).updated_at ?? null,
    ydoc_state_len: (data.ydoc_state ?? "").length,
    content_len: (data.content ?? "").length,
  };
}

export async function fetchOldSlugCleanupStatus(page: Page, slug: string): Promise<OldSlugCleanupStatus> {
  return page.evaluate(async (slug) => {
    const modulePath = "/src/lib/rename-cleanup-status.ts";
    const mod = await import(/* @vite-ignore */ modulePath);
    return mod.fetchOldSlugCleanupStatus(slug);
  }, slug) as Promise<OldSlugCleanupStatus>;
}

export type WaitForSlugAbsentOptions = {
  /** Total time to keep polling before failing. Defaults to 3000ms. */
  timeoutMs?: number;
  /** Delay between polls. Defaults to 150ms. */
  intervalMs?: number;
};

/**
 * Poll until `slug` is absent from `notes` or timeout. Returns the last
 * snapshot seen (null on success). Callers can attach the snapshot to
 * failure output to diagnose resurrections.
 */
export async function waitForSlugAbsent(
  slug: string,
  opts: WaitForSlugAbsentOptions = {},
): Promise<NoteRowSnapshot> {
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const intervalMs = opts.intervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;
  let last: NoteRowSnapshot = null;
  while (Date.now() < deadline) {
    last = await snapshotSlugRow(slug);
    if (!last) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

export type OldSlugPresence = {
  phase: "db-before-ui" | "ui" | "db-after-ui";
  db: NoteRowSnapshot;
  uiTextMatched: boolean;
  uiText?: string;
};

export async function verifyOldSlugGoneFromDbAndUi(
  page: Page,
  slug: string,
  opts: WaitForSlugAbsentOptions & {
    forbiddenText?: string;
    postRevisitTimeoutMs?: number;
  } = {},
): Promise<OldSlugPresence | null> {
  const status = await fetchOldSlugCleanupStatus(page, slug).catch(() => null);
  if (status?.database.rowPresent) {
    return { phase: "db-before-ui", db: status.database.row, uiTextMatched: false };
  }
  const beforeUi = await waitForSlugAbsent(slug, opts);
  if (beforeUi) return { phase: "db-before-ui", db: beforeUi, uiTextMatched: false };

  await page.goto(`/${slug}`);
  if (opts.forbiddenText) {
    const editor = page.locator(".cm-content").first();
    try {
      await editor.waitFor({ state: "visible", timeout: 5_000 });
      const uiText = await editor.innerText({ timeout: 2_000 });
      if (uiText.includes(opts.forbiddenText)) {
        return {
          phase: "ui",
          db: await snapshotSlugRow(slug),
          uiTextMatched: true,
          uiText,
        };
      }
    } catch {
      /* no editor rendered is acceptable for a deleted slug */
    }
  }

  const afterUi = await waitForSlugAbsent(slug, {
    timeoutMs: opts.postRevisitTimeoutMs ?? 3_000,
    intervalMs: opts.intervalMs,
  });
  if (afterUi) return { phase: "db-after-ui", db: afterUi, uiTextMatched: false };
  return null;
}

/**
 * Runs `verifyOldSlugGoneFromDbAndUi` repeatedly until it returns null (gone)
 * or all attempts fail. Yjs broadcast timing is inherently racy — this smooths
 * the last-mile of the debounce/finalize window without hiding real regressions.
 */
export async function verifyOldSlugGoneWithRetry(
  page: Page,
  slug: string,
  opts: Parameters<typeof verifyOldSlugGoneFromDbAndUi>[2] & {
    attempts?: number;
    backoffMs?: number;
    label?: string;
  } = {},
): Promise<OldSlugPresence | null> {
  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? 500;
  let last: OldSlugPresence | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await verifyOldSlugGoneFromDbAndUi(page, slug, opts);
    if (!last) return null;
    // eslint-disable-next-line no-console
    console.log(
      `[rename-race][${opts.label ?? "verify"}] attempt ${i + 1}/${attempts} still-present`,
      { slug, phase: last.phase, db: last.db },
    );
    await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
  }
  return last;
}
