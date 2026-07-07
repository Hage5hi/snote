// Shared DB assertion helpers for E2E specs that need to poll the notes
// table across the Yjs debounce/finalize window (rename race, snapshot
// resurrection, etc.). Uses the anon key — same client seed helpers use.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
