// Rename or duplicate a note's slug. Both operations copy the full row
// (including encryption metadata so the same password unlocks the new URL).
// Rename additionally deletes the source and migrates localStorage.
//
// Error messages are kept in English here; UI callers translate via i18n
// before showing them in toasts.
import { supabase } from "@/integrations/supabase/client";
import { renamePinned, renameRecent } from "@/lib/recent-notes";
import { renameShareToken } from "@/lib/share-tokens";

export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Returns true if `slug` is free (no row, or row exists but is empty —
 * matching Home.tsx's "auto-created from prefetch" tolerance).
 */
export async function checkSlugAvailable(slug: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("notes")
    .select("slug, char_count")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return true;
  return (data.char_count ?? 0) === 0;
}

/** Copy source row contents into `targetSlug`. Used by both rename + duplicate. */
async function copyNoteRow(sourceSlug: string, targetSlug: string) {
  const { data: src, error: fetchErr } = await supabase
    .from("notes")
    .select("*")
    .eq("slug", sourceSlug)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!src) throw new Error("Source note not found");

  const { error: insertErr } = await supabase.from("notes").upsert(
    {
      slug: targetSlug,
      ydoc_state: src.ydoc_state,
      content: src.content,
      tags: src.tags,
      is_encrypted: src.is_encrypted,
      enc_salt: src.enc_salt,
      enc_check: src.enc_check,
      enc_iterations: src.enc_iterations,
      char_count: src.char_count,
    },
    { onConflict: "slug" },
  );
  if (insertErr) throw insertErr;
}

export async function renameNote(oldSlug: string, newSlug: string): Promise<void> {
  if (oldSlug === newSlug) return;
  if (!SLUG_RE.test(newSlug)) throw new Error("Invalid slug");

  await copyNoteRow(oldSlug, newSlug);

  // Migrate active share tokens BEFORE the delete. note_shares FK is ON
  // DELETE CASCADE, so deleting the old row would otherwise destroy every
  // share link for this note. share-rename runs with the service role and
  // re-points the token rows at newSlug; the subsequent delete cascades
  // onto an empty set.
  const { error: shareErr } = await supabase.functions.invoke("share-rename", {
    body: { oldSlug, newSlug },
  });
  if (shareErr) throw shareErr;

  // Remove the old row. If this fails the new row still exists.
  const { error: delErr } = await supabase.from("notes").delete().eq("slug", oldSlug);
  if (delErr) throw delErr;

  renameRecent(oldSlug, newSlug);
  renamePinned(oldSlug, newSlug);
  renameShareToken(oldSlug, newSlug);
}

/**
 * Copy the source note into a new slug, leaving the source untouched.
 * Caller is responsible for navigating to `/<newSlug>` afterwards.
 */
export async function duplicateNote(sourceSlug: string, newSlug: string): Promise<void> {
  if (sourceSlug === newSlug) throw new Error("New slug must differ from source");
  if (!SLUG_RE.test(newSlug)) throw new Error("Invalid slug");
  await copyNoteRow(sourceSlug, newSlug);
}
