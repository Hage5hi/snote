import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const plan = readFileSync(
  resolve(process.cwd(), "docs/security/staging-plan-2026-08.md"),
  "utf8",
);
const normalizedPlan = plan.replace(/\s+/g, " ");

describe("G3 staging plan safety contract", () => {
  it("separates repository readiness, local polling, and hosted staging", () => {
    expect(normalizedPlan).toContain("## G3A — repository readiness");
    expect(normalizedPlan).toContain("## G3B — local polling rehearsal");
    expect(normalizedPlan).toContain("## G3C — hosted staging");
    expect(normalizedPlan).toContain("G3A does not run Docker or the Supabase CLI");
    expect(normalizedPlan).toContain("G3B requires separate owner approval");
    expect(normalizedPlan).toContain("G3C requires separate owner approval");
  });

  it("uses only the generated local workdir and excludes atomic cutover", () => {
    expect(normalizedPlan).toContain("bun run staging:prepare");
    expect(normalizedPlan).toContain('bunx supabase --workdir "<generated-workdir>" start');
    expect(normalizedPlan).toContain(
      'bunx supabase --workdir "<generated-workdir>" db reset --local',
    );
    expect(normalizedPlan).toContain("20260724000000_atomic_capability_cutover.sql");
    expect(normalizedPlan).toContain("must not appear in the generated workdir or migration ledger");
    expect(normalizedPlan).toContain("onfzjmfjldsbthchssfr");
    expect(normalizedPlan).toContain("must be rejected");
  });

  it("keeps local runtime polling-first and defers hosted auth and Realtime", () => {
    expect(normalizedPlan).toContain("writes=false, privateRealtime=false");
    expect(normalizedPlan).toContain("writes=true, privateRealtime=false");
    expect(normalizedPlan).toContain("return to `false,false`");
    expect(normalizedPlan).toContain("VITE_CAPABILITY_ROUTES_ENABLED=true");
    expect(normalizedPlan).toContain("VITE_CAPABILITY_AUTH_ENABLED");
    expect(normalizedPlan).toContain("Turnstile");
    expect(normalizedPlan).toContain("anonymous Auth");
    expect(normalizedPlan).toContain("five-minute JWT");
    expect(normalizedPlan).toContain("private Realtime");
  });

  it("requires complete hosted containment, recovery, and evidence identity", () => {
    expect(normalizedPlan).toContain("admin login and capability note create/import");
    expect(normalizedPlan).toContain("raw");
    expect(normalizedPlan).toContain("share-revoke");
    expect(normalizedPlan).toContain("verify_jwt");
    expect(normalizedPlan).toContain("logical dump");
    expect(normalizedPlan).toContain("checksum");
    expect(normalizedPlan).toContain("restore rehearsal");
    expect(plan).not.toMatch(/guaranteed PITR/i);
    expect(normalizedPlan).toContain("SPA source SHA and build ID");
    expect(normalizedPlan).toContain("Edge Function source hashes and deployed versions");
    expect(normalizedPlan).toContain("Worker deployment ID, routes, and config hash");
    expect(normalizedPlan).toContain("migration filenames and SHA-256 hashes");
    expect(normalizedPlan).toContain("staging project ref and region");
    expect(normalizedPlan).toContain("runtime flags and Auth mode");
    expect(normalizedPlan).toContain("redaction scan");
  });
});
