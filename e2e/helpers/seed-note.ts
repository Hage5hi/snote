// Seeds notes deterministically via the anon key for E2E tests.
//
// Two flavors:
//   - seedPlaintextNote(slug, text): upserts a plaintext row.
//   - seedEncryptedNote(slug, passphrase, text): derives a key with PBKDF2,
//     encrypts an initial Yjs state, and upserts the row so the app treats it
//     as an already-encrypted note. The passphrase is what the UI expects in
//     the URL hash (`/<slug>#<passphrase>`).
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from process.env
// (dotenv-style loading is handled by whatever runs the tests; Playwright's
// webServer inherits the shell env). Falls back to `.env` values if unset.

import { createClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import {
  deriveKey,
  encryptBytes,
  makeCheck,
  randomSalt,
  PBKDF2_ITERATIONS,
} from "../../src/lib/crypto";
import { bytesToBase64 } from "../../src/lib/yjs/base64";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (needed for E2E seeding).`);
  return v;
}

function client() {
  return createClient(env("VITE_SUPABASE_URL"), env("VITE_SUPABASE_PUBLISHABLE_KEY"));
}

export async function deleteNote(slug: string): Promise<void> {
  await client().from("notes").delete().eq("slug", slug);
}

/**
 * Deterministic-yet-unique slug per test run — includes a caller-supplied
 * tag, worker index (parallel CI shards), a per-process counter, and a
 * timestamp+random suffix. Prevents collisions across parallel jobs while
 * keeping the slug readable in Playwright traces.
 */
let __seedCounter = 0;
export function versionedSlug(tag: string, variant: "plain" | "enc" = "plain"): string {
  __seedCounter += 1;
  const worker = process.env.TEST_WORKER_INDEX ?? "0";
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-${tag}-${variant}-w${worker}-n${__seedCounter}-${ts}-${rand}`;
}

/** Seed a plaintext note under a freshly-versioned slug and return the slug. */
export async function seedVersionedPlaintextNote(
  tag: string,
  text: string,
): Promise<string> {
  const slug = versionedSlug(tag, "plain");
  await seedPlaintextNote(slug, text);
  return slug;
}

/** Seed an encrypted note under a freshly-versioned slug and return the slug. */
export async function seedVersionedEncryptedNote(
  tag: string,
  passphrase: string,
  text: string,
): Promise<string> {
  const slug = versionedSlug(tag, "enc");
  await seedEncryptedNote(slug, passphrase, text);
  return slug;
}

export async function seedPlaintextNote(slug: string, text: string): Promise<void> {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  const state = Y.encodeStateAsUpdate(doc);
  const { error } = await client()
    .from("notes")
    .upsert(
      {
        slug,
        is_encrypted: false,
        enc_salt: null,
        enc_check: null,
        ydoc_state: bytesToBase64(state),
        content: text,
        char_count: text.length,
      },
      { onConflict: "slug" },
    );
  if (error) throw error;
}

export async function seedEncryptedNote(
  slug: string,
  passphrase: string,
  text: string,
): Promise<void> {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  const state = Y.encodeStateAsUpdate(doc);

  const salt = randomSalt();
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const check = await makeCheck(key);
  const encrypted = await encryptBytes(key, state);

  const { error } = await client()
    .from("notes")
    .upsert(
      {
        slug,
        is_encrypted: true,
        enc_salt: salt,
        enc_check: check,
        enc_iterations: PBKDF2_ITERATIONS,
        ydoc_state: bytesToBase64(encrypted),
        content: "",
        char_count: 0,
      },
      { onConflict: "slug" },
    );
  if (error) throw error;
}
