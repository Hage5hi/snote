// API-level authorization: while a note is locked (is_encrypted=true), the
// server must reject plaintext edits from a client with just the anon key —
// regardless of what the UI does. This guarantees that a rogue/legacy client
// with a stale provider or a hand-crafted REST call cannot corrupt locked
// note content.
//
// We use the same anon key the app uses; if the anon role is allowed to
// overwrite an encrypted row, that's the bug this test catches.

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import {
  deleteNote,
  seedEncryptedNote,
  versionedSlug,
} from "./helpers/seed-note";
import { bytesToBase64 } from "../src/lib/yjs/base64";

const PASSPHRASE = "correct-horse-battery-staple";
const TEXT = "Server-enforced lock.";

function anon() {
  const url = process.env.VITE_SUPABASE_URL!;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key);
}

test.describe("API-level lock enforcement", () => {
  let slug: string;

  test.beforeEach(async () => {
    slug = versionedSlug("apilock", "enc");
    await seedEncryptedNote(slug, PASSPHRASE, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(slug).catch(() => {});
  });

  test("anon client cannot overwrite a locked note with plaintext", async () => {
    const client = anon();

    // Snapshot the encrypted row for comparison.
    const before = await client
      .from("notes")
      .select("is_encrypted, ydoc_state, enc_salt, enc_check")
      .eq("slug", slug)
      .single();
    expect(before.error).toBeNull();
    expect(before.data?.is_encrypted).toBe(true);
    const originalState = before.data?.ydoc_state;

    // Attempt a hostile plaintext write bypassing the UI.
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "STALE-CLIENT-OVERWRITE");
    const state = Y.encodeStateAsUpdate(doc);
    const attempt = await client
      .from("notes")
      .update({
        is_encrypted: false,
        enc_salt: null,
        enc_check: null,
        ydoc_state: bytesToBase64(state),
        content: "STALE-CLIENT-OVERWRITE",
        char_count: "STALE-CLIENT-OVERWRITE".length,
      })
      .eq("slug", slug)
      .select();

    // Success shape: either the request errors, or RLS silently returns
    // zero rows updated. In BOTH cases, the row must be unchanged.
    if (!attempt.error) {
      expect(
        attempt.data?.length ?? 0,
        `Server allowed ${attempt.data?.length} row update to a locked note`,
      ).toBe(0);
    }

    const after = await client
      .from("notes")
      .select("is_encrypted, ydoc_state")
      .eq("slug", slug)
      .single();
    expect(after.error).toBeNull();
    expect(after.data?.is_encrypted, "lock flag was cleared by anon").toBe(true);
    expect(after.data?.ydoc_state, "encrypted state was overwritten by anon").toBe(
      originalState,
    );
  });
});
