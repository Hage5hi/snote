import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("admin passphrase rotation containment", () => {
  it("consumes the still-live caller before updating the hash and revoking every session", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const rotate = source("supabase/functions/admin-rotate/index.ts");

    const rotateFunction = migration.match(
      /CREATE OR REPLACE FUNCTION public\.admin_pass_rotate\(\s*p_pass_hash text,\s*p_token_hash text,\s*p_subject_hash text\s*\)[\s\S]*?\$\$;/i,
    )?.[0] ?? "";
    expect(rotateFunction).not.toBe("");
    expect(rotateFunction).toMatch(/SECURITY DEFINER/i);
    expect(rotateFunction).toMatch(
      /DELETE FROM public\.admin_sessions[\s\S]*?token_hash = p_token_hash[\s\S]*?subject_hash = p_subject_hash[\s\S]*?expires_at > statement_timestamp\(\)[\s\S]*?RETURNING token_hash/i,
    );
    expect(rotateFunction).toMatch(/IF NOT FOUND THEN[\s\S]*?RAISE EXCEPTION/i);

    const consumeSessionAt = rotateFunction.indexOf(
      "DELETE FROM public.admin_sessions",
    );
    const updateHashAt = rotateFunction.indexOf(
      "INSERT INTO public.admin_config",
    );
    expect(consumeSessionAt).toBeGreaterThan(-1);
    expect(updateHashAt).toBeGreaterThan(consumeSessionAt);
    expect(rotateFunction).toMatch(
      /INSERT INTO public\.admin_config[\s\S]*?ON CONFLICT \(id\) DO UPDATE[\s\S]*?DELETE FROM public\.admin_sessions/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_pass_rotate\(text, text, text\)\s+FROM PUBLIC, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_pass_rotate\(text, text, text\) TO service_role/i,
    );

    expect(rotate).toContain('.rpc("admin_pass_rotate"');
    expect(rotate).toContain("p_pass_hash: passHash");
    expect(rotate).toContain("p_token_hash: authorization.tokenHash");
    expect(rotate).toContain("p_subject_hash: authorization.subjectHash");
    expect(rotate).not.toContain('.from("admin_config")');
  });

  it("purges the revoked token and cached admin data instead of reusing the session", () => {
    const panel = source("src/pages/AdminPanel.tsx");
    const rotateDialog = source("src/components/admin/RotatePassDialog.tsx");

    const purge = panel.match(
      /const purgeAdminState = useCallback\([\s\S]*?\n  \);/,
    )?.[0] ?? "";
    expect(purge).not.toBe("");
    expect(purge).toContain("sessionStorage.removeItem(SESSION_TOKEN_KEY)");
    expect(purge).toContain("sessionStorage.removeItem(SESSION_EXPIRY_KEY)");
    expect(purge).toContain('setGate("denied")');
    expect(purge).toContain('setSessionToken("")');
    expect(purge).toContain("setItems([])");
    expect(purge).toContain('setSearch("")');
    expect(purge).toContain('setTagFilter("")');
    expect(purge).toContain("setConfirmOpen(null)");
    expect(panel).toContain("purgeAdminState(true)");
    expect(panel).toContain("onSuccess={handleRotateUnauthorized}");
    expect(panel).toContain("onUnauthorized={handleRotateUnauthorized}");
    expect(panel).toContain("validateSession={validateRotateSession}");
    expect(panel).not.toMatch(
      /onSuccess=\{\(\) => void fetchList\(sessionToken, search, tagFilter\)\}/,
    );

    expect(rotateDialog).toContain(
      "onUnauthorized: (rejectedToken: string, generation: number) => boolean",
    );
    expect(rotateDialog).toContain(
      "validateSession: (token: string, generation: number) => boolean",
    );
    expect(rotateDialog).toMatch(/status === 401 \|\| status === 403/);
    expect(rotateDialog).toContain(
      "onUnauthorized(sessionToken, sessionGeneration)",
    );
    expect(rotateDialog).toContain(
      "if (!validateSession(sessionToken, sessionGeneration)) return",
    );
  });
});
