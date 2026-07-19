import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("atomic admin authentication admission", () => {
  it("reserves one expiring per-subject lease before running bcrypt", () => {
    const migration = source(
      "../../supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const session = source("../../supabase/functions/admin-session/index.ts");

    expect(migration).toContain("lease_id text");
    expect(migration).toContain("lease_until timestamptz");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.admin_auth_begin(");
    expect(migration).toMatch(/ON CONFLICT \(subject_hash\) DO UPDATE[\s\S]*lease_until[\s\S]*WHERE[\s\S]*attempts\.locked_until[\s\S]*attempts\.lease_until/);

    const begin = session.indexOf("beginAdminAuthAttempt(");
    const verify = session.indexOf("verifyAdminPass(");
    const complete = session.indexOf("completeAdminAuthAttempt(");
    expect(begin).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(begin);
    expect(complete).toBeGreaterThan(verify);
    expect(session).not.toContain("checkAdminLockout(");
    expect(session).not.toContain("recordAdminAuthAttempt(");
  });

  it("accepts completion only for the active, unexpired lease under a row lock", () => {
    const migration = source(
      "../../supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const limiter = source(
      "../../supabase/functions/_shared/admin-rate-limit.ts",
    );

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.admin_auth_complete(");
    expect(migration).toMatch(/WHERE subject_hash = p_subject_hash[\s\S]*lease_id = p_lease_id[\s\S]*FOR UPDATE/);
    expect(migration).toMatch(/lease_until <= v_now[\s\S]*RAISE EXCEPTION/);
    expect(migration).toMatch(/SET lease_id = NULL,[\s\S]*lease_until = NULL/);
    expect(limiter).toContain("beginAdminAuthAttempt");
    expect(limiter).toContain("completeAdminAuthAttempt");
    expect(limiter).toContain("p_lease_id");
  });

  it("keeps admission RPCs service-role-only", () => {
    const migration = source(
      "../../supabase/migrations/20260719000000_security_immediate_containment.sql",
    );

    for (const signature of [
      "public.admin_auth_begin(text, text)",
      "public.admin_auth_complete(text, text, boolean)",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature}`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`);
    }
  });
});
