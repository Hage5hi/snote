import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("admin security-data retention", () => {
  it("prunes expired sessions and stale keyed limiter rows through a service-role RPC", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );

    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_security_prune\(\)[\s\S]*?DELETE FROM public\.admin_sessions[\s\S]*?expires_at <= v_now/i,
    );
    expect(migration).toMatch(
      /DELETE FROM public\.admin_auth_attempts[\s\S]*?first_failure_at < v_now - interval '7 days'[\s\S]*?locked_until[\s\S]*?lease_until/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_security_prune\(\)[\s\S]*?FROM PUBLIC, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_security_prune\(\) TO service_role/i,
    );
  });

  it("fails admin authentication closed when opportunistic pruning is unavailable", () => {
    const session = source("supabase/functions/admin-session/index.ts");
    const pruneAt = session.indexOf('rpc("admin_security_prune")');
    const authBranchAt = session.indexOf('if (req.method === "DELETE")');

    expect(pruneAt).toBeGreaterThan(-1);
    expect(authBranchAt).toBeGreaterThan(pruneAt);
    expect(session).toMatch(
      /rpc\("admin_security_prune"\)[\s\S]*?serviceUnavailableResponse\(corsHeaders\)/,
    );
  });

  it("requires a daily production retention job and documents the keyed data", () => {
    const rollout = source("docs/security/immediate-containment-rollout.md");
    const privacy = source("src/pages/Privacy.tsx");

    expect(rollout).toContain("admin_security_prune()");
    expect(rollout).toMatch(/daily retention job/i);
    expect(privacy).toMatch(/keyed admin abuse-prevention hashes/i);
    expect(privacy).toMatch(/seven\s+days/i);
  });
});
