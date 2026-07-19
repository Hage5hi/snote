import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

describe("admin passphrase rotation containment", () => {
  it("updates the pass hash and revokes every admin session in one service-role RPC", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const rotate = source("supabase/functions/admin-rotate/index.ts");

    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_pass_rotate\(\s*p_pass_hash text\s*\)[\s\S]*?SECURITY DEFINER[\s\S]*?INSERT INTO public\.admin_config[\s\S]*?ON CONFLICT \(id\) DO UPDATE[\s\S]*?DELETE FROM public\.admin_sessions[\s\S]*?\$\$;/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_pass_rotate\(text\)\s+FROM PUBLIC, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_pass_rotate\(text\) TO service_role/i,
    );

    expect(rotate).toContain('.rpc("admin_pass_rotate"');
    expect(rotate).toContain("p_pass_hash: passHash");
    expect(rotate).not.toContain('.from("admin_config")');
  });

  it("purges the revoked token and cached admin data instead of reusing the session", () => {
    const panel = source("src/pages/AdminPanel.tsx");

    expect(panel).toMatch(
      /const clearAdminSession = \(\) => \{[\s\S]*?sessionStorage\.removeItem\(SESSION_TOKEN_KEY\)[\s\S]*?setGate\("denied"\)[\s\S]*?setSessionToken\(""\)[\s\S]*?setItems\(\[\]\)[\s\S]*?\};/,
    );
    expect(panel).toContain("onSuccess={clearAdminSession}");
    expect(panel).not.toMatch(
      /onSuccess=\{\(\) => void fetchList\(sessionToken, search, tagFilter\)\}/,
    );
  });
});
