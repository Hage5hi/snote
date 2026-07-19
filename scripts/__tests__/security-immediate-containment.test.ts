import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

function source(path: string): string {
  const absolutePath = join(root, path);
  expect(existsSync(absolutePath), `${path} must exist`).toBe(true);
  return readFileSync(absolutePath, "utf8");
}

describe("immediate containment contracts", () => {
  it("revokes public note deletion in a forward-only migration", () => {
    const historical = source(
      "supabase/migrations/20260420041258_01f4e8f4-7ae1-49f4-a144-14f107a60c09.sql",
    );
    expect(historical).toContain('CREATE POLICY "Anyone can delete notes"');

    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS\s+"Anyone can delete notes"\s+ON public\.notes/i,
    );
    expect(migration).toMatch(
      /REVOKE DELETE ON TABLE public\.notes FROM anon, authenticated/i,
    );
  });

  it("uses one atomic SQL transition for concurrent admin failures", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_auth_record/i,
    );
    expect(migration).toMatch(/ON CONFLICT \(subject_hash\) DO UPDATE/i);
    expect(migration).toMatch(/RENAME COLUMN ip TO subject_hash/i);
    expect(migration).toMatch(/TRUNCATE TABLE public\.admin_auth_attempts/i);
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_auth_record[\s\S]*FROM PUBLIC, anon, authenticated/i,
    );

    const limiter = source("supabase/functions/_shared/admin-rate-limit.ts");
    expect(limiter).toContain('.rpc("admin_auth_record"');
    expect(limiter).not.toContain('.select("failure_count');
    expect(limiter).not.toContain('.update(update)');
  });

  it("fails closed when rate-limit or session storage is unavailable", () => {
    const limiter = source("supabase/functions/_shared/admin-rate-limit.ts");
    expect(limiter).toContain("serviceUnavailableResponse");
    expect(limiter).toMatch(/if \(error\)[\s\S]*available: false/);

    const auth = source("supabase/functions/_shared/admin-auth.ts");
    expect(auth).toContain("serviceUnavailableResponse");
    expect(auth).toMatch(/if \(error\)[\s\S]*unavailable/);

    for (const name of ["admin-list", "admin-delete", "admin-rotate", "cleanup"]) {
      const consumer = source(`supabase/functions/${name}/index.ts`);
      expect(consumer, name).toContain("authorizeAdminSession");
      expect(consumer, name).toContain("adminAuthResponse");
    }
  });

  it("derives a privacy-preserving client key only from strict provider X-Forwarded-For", () => {
    const auth = source("supabase/functions/_shared/admin-auth.ts");
    expect(auth).toContain('headers.get("x-forwarded-for")');
    expect(auth).toContain('rawIp.includes(",")');
    expect(auth).not.toContain("cf-connecting-ip");
    expect(auth).not.toContain("x-real-ip");
    expect(auth).toContain('Deno.env.get("ADMIN_RATE_LIMIT_HMAC_SECRET")');
    expect(auth).toContain('crypto.subtle.importKey("raw"');
    expect(auth).toContain('crypto.subtle.sign("HMAC"');
  });

  it("never infers encrypted-note emptiness from ciphertext length", () => {
    const cleanup = source("supabase/functions/cleanup/index.ts");
    expect(cleanup).toContain('.eq("is_encrypted", false)');
    expect(cleanup).not.toContain('.eq("is_encrypted", true)');
    expect(cleanup).not.toContain('select("slug, ydoc_state")');
    expect(cleanup).not.toContain("emptySlugs");
    expect(cleanup).not.toMatch(/ydoc_state[^\n]*length/);
  });

  it("tombstones share-rename without initializing or calling the database", () => {
    const rename = source("supabase/functions/share-rename/index.ts");
    expect(rename).toMatch(/status:\s*410/);
    expect(rename).toContain('"Cache-Control": "no-store"');
    expect(rename).toContain('error: "endpoint retired"');
    expect(rename).not.toContain("createClient");
    expect(rename).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(rename).not.toContain('.from("note_shares")');
  });

  it("exchanges the passphrase once for a short opaque server-side session", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_sessions/i);
    expect(migration).toContain("token_hash");
    expect(migration).toContain("expires_at");

    const session = source("supabase/functions/admin-session/index.ts");
    expect(session).toContain("crypto.getRandomValues");
    expect(session).toContain('.from("admin_sessions")');
    expect(session).toContain('"Cache-Control": "no-store"');
    expect(session).toContain("ADMIN_SESSION_TTL_MINUTES");

    for (const name of ["admin-list", "admin-delete", "admin-rotate", "cleanup"]) {
      const consumer = source(`supabase/functions/${name}/index.ts`);
      expect(consumer, name).not.toContain("passphrase");
      expect(consumer, name).not.toContain("bcrypt");
    }
  });

  it("stores only the opaque session token in sessionStorage", () => {
    const panel = source("src/pages/AdminPanel.tsx");
    expect(panel).toContain("SESSION_TOKEN_KEY");
    expect(panel).toContain('functions.invoke("admin-session"');
    expect(panel).toContain('"x-admin-session"');
    expect(panel).not.toMatch(/sessionStorage\.setItem\([^\n]*candidate/);
    expect(panel).not.toMatch(/sessionStorage\.setItem\([^\n]*newPass/);

    const rotate = source("src/components/admin/RotatePassDialog.tsx");
    expect(rotate).toContain("sessionToken");
    expect(rotate).toContain('"x-admin-session"');
    expect(rotate).not.toContain("currentPass");
  });
});

