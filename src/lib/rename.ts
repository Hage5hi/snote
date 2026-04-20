// Rename a note's slug: copy row to the new slug, delete the old one,
// and migrate localStorage (recents + pinned). Encrypted notes keep their
// salt + check digest so the same password still unlocks the new URL.
import { supabase } from "@/integrations/supabase/client";
import { renamePinned, renameRecent } from "@/lib/recent-notes";

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

export async function renameNote(oldSlug: string, newSlug: string): Promise<void> {
  if (oldSlug === newSlug) return;
  if (!SLUG_RE.test(newSlug)) throw new Error("Slug không hợp lệ");

  // 1. Fetch the source row in full.
  const { data: src, error: fetchErr } = await supabase
    .from("notes")
    .select("*")
    .eq("slug", oldSlug)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!src) throw new Error("Không tìm thấy note nguồn");

  // 2. Upsert into new slug. Use upsert in case the destination is an
  //    empty placeholder row created by a prefetch.
  const { error: insertErr } = await supabase.from("notes").upsert(
    {
      slug: newSlug,
      ydoc_state: src.ydoc_state,
      content: src.content,
      tags: src.tags,
      is_encrypted: src.is_encrypted,
      enc_salt: src.enc_salt,
      enc_check: src.enc_check,
      char_count: src.char_count,
    },
    { onConflict: "slug" },
  );
  if (insertErr) throw insertErr;

  // 3. Remove the old row. If this fails the new row still exists — user
  //    can manually clean up later.
  const { error: delErr } = await supabase.from("notes").delete().eq("slug", oldSlug);
  if (delErr) throw delErr;

  // 4. Migrate local state.
  renameRecent(oldSlug, newSlug);
  renamePinned(oldSlug, newSlug);
}
