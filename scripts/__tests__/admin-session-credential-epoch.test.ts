import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("admin session credential epoch", () => {
  it("reads the password material and epoch from one service-role-only SQL snapshot", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const auth = source("supabase/functions/_shared/admin-auth.ts");

    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.admin_auth_state[\s\S]*credential_epoch bigint/i,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_credential_material\(\)[\s\S]*RETURNS TABLE\([\s\S]*pass_hash text[\s\S]*credential_epoch bigint[\s\S]*LEFT JOIN public\.admin_config/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_credential_material\(\)[\s\S]*FROM PUBLIC, anon, authenticated/i,
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.admin_credential_material() TO service_role",
    );
    expect(auth).toContain('.rpc("admin_credential_material"');
    expect(auth).toContain("credentialEpoch");
    expect(auth).not.toContain('.from("admin_config")');
  });

  it("issues a session only while the verified credential epoch is still current", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const session = source("supabase/functions/admin-session/index.ts");

    const issueFunction = migration.match(
      /CREATE OR REPLACE FUNCTION public\.admin_session_issue\([\s\S]*?\$\$;/i,
    )?.[0] ?? "";
    expect(issueFunction).not.toBe("");
    expect(issueFunction).toMatch(
      /SELECT[\s\S]*credential_epoch[\s\S]*FROM public\.admin_auth_state[\s\S]*FOR UPDATE/i,
    );
    expect(issueFunction).toMatch(
      /credential_epoch[^;]*p_credential_epoch[\s\S]*RAISE EXCEPTION[\s\S]*INSERT INTO public\.admin_sessions/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_session_issue\(text, text, timestamptz, bigint\)[\s\S]*FROM PUBLIC, anon, authenticated/i,
    );
    expect(session).toContain('.rpc("admin_session_issue"');
    expect(session).toContain("p_credential_epoch: verified.credentialEpoch");
    expect(session).not.toContain('.from("admin_sessions").insert');
  });

  it("serializes rotation on the same epoch row before consuming the caller", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const rotateFunction = migration.match(
      /CREATE OR REPLACE FUNCTION public\.admin_pass_rotate\([\s\S]*?\$\$;/i,
    )?.[0] ?? "";

    const lockAt = rotateFunction.indexOf("FROM public.admin_auth_state");
    const consumeAt = rotateFunction.indexOf("DELETE FROM public.admin_sessions");
    const incrementAt = rotateFunction.indexOf("credential_epoch = credential_epoch + 1");
    const revokeAt = rotateFunction.lastIndexOf("DELETE FROM public.admin_sessions");

    expect(lockAt).toBeGreaterThan(-1);
    expect(consumeAt).toBeGreaterThan(lockAt);
    expect(incrementAt).toBeGreaterThan(consumeAt);
    expect(revokeAt).toBeGreaterThan(incrementAt);
    expect(rotateFunction).toMatch(/FROM public\.admin_auth_state[\s\S]*FOR UPDATE/i);
  });
});
