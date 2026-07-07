// Rename or duplicate a note's slug. Both operations copy the full row
// (including encryption metadata so the same password unlocks the new URL).
// Rename additionally deletes the source and migrates localStorage.
//
// Error messages are kept in English here; UI callers translate via i18n
// before showing them in toasts.
import { supabase } from "@/integrations/supabase/client";
import { renamePinned, renameRecent } from "@/lib/recent-notes";
import { renameShareToken } from "@/lib/share-tokens";
import { abandonProviderForSlug } from "@/lib/yjs/provider";
import { evictDoc } from "@/lib/yjs/doc-cache";
import { clearSnapshots } from "@/lib/snapshots";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

async function clearIndexedDbDoc(slug: string) {
  if (typeof indexedDB === "undefined") return;
  const doc = new Y.Doc();
  try {
    const idb = new IndexeddbPersistence(`note:${slug}`, doc);
    await idb.clearData();
  } finally {
    doc.destroy();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

/** Clear local state that could otherwise rehydrate a slug after it was renamed away. */
export async function clearRenamedSlugLocalState(oldSlug: string): Promise<void> {
  abandonProviderForSlug(oldSlug);
  evictDoc(oldSlug);
  try {
    sessionStorage.removeItem(`note-snapshot:${oldSlug}`);
  } catch {
    /* unavailable */
  }
  await Promise.allSettled([
    withTimeout(clearIndexedDbDoc(oldSlug), 750),
    withTimeout(clearSnapshots(oldSlug), 750),
  ]);
}

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

/**
 * Copy the note row and migrate share tokens to `newSlug`. Does NOT delete
 * the source row — call {@link finalizeRename} AFTER the UI has navigated
 * away from `oldSlug` so the still-mounted Yjs provider (which debounces
 * snapshot upserts) can't recreate the source row post-delete.
 */
export async function prepareRename(oldSlug: string, newSlug: string): Promise<void> {
  if (oldSlug === newSlug) return;
  if (!SLUG_RE.test(newSlug)) throw new Error("Invalid slug");

  await copyNoteRow(oldSlug, newSlug);

  const { error: shareErr } = await supabase.functions.invoke("share-rename", {
    body: { oldSlug, newSlug },
  });
  if (shareErr) throw shareErr;

  // Mark the old slug as abandoned only after the copy/share work succeeds.
  // If preparation fails, the user remains on the old note and it must keep
  // saving normally. Finalization/navigation happens immediately after this.
  abandonProviderForSlug(oldSlug);
}

/**
 * Delete the source row and migrate localStorage. Must be called AFTER the
 * caller has navigated away from `/oldSlug` (so the old Yjs provider is
 * unmounted). Runs a second-pass delete after a short delay to defeat any
 * last debounced snapshot upsert that raced the unmount.
 */
export async function finalizeRename(
  oldSlug: string,
  newSlug: string,
): Promise<{ deletionConfirmed: boolean }> {
  const del = async () => {
    const { error } = await supabase.from("notes").delete().eq("slug", oldSlug);
    if (error) throw error;
  };
  await del();
  await new Promise((r) => setTimeout(r, 750));
  try {
    await del();
  } catch {
    /* best-effort second pass */
  }

  renameRecent(oldSlug, newSlug);
  renamePinned(oldSlug, newSlug);
  renameShareToken(oldSlug, newSlug);

  // Verify the old row is fully gone (no debounced upsert resurrected it).
  const { data } = await supabase
    .from("notes")
    .select("slug")
    .eq("slug", oldSlug)
    .maybeSingle();
  return { deletionConfirmed: !data };
}

/** One-shot rename. UI callers should prefer prepareRename + navigate + finalizeRename. */
export async function renameNote(oldSlug: string, newSlug: string): Promise<void> {
  await prepareRename(oldSlug, newSlug);
  await finalizeRename(oldSlug, newSlug);
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
