import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260724000000_atomic_capability_cutover.sql",
), "utf8");
const legacyShareEdge = readFileSync(resolve(
  process.cwd(),
  "supabase/functions/share-view/index.ts",
), "utf8");
const legacyShareCreate = readFileSync(resolve(
  process.cwd(),
  "supabase/functions/share-create/index.ts",
), "utf8");
const appShell = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
const cutoverVerifier = readFileSync(resolve(
  process.cwd(),
  "scripts/verify-capability-cutover.ts",
), "utf8");

describe("atomic cutover migration", () => {
  it("removes every direct notes policy and privilege in one transaction", () => {
    expect(migration).toMatch(/^BEGIN;/m);
    expect(migration).toMatch(/pg_catalog\.pg_policy/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.notes FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.note_shares FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.legacy_share_rotate\(text, text\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(migration).toMatch(/COMMIT;/);
  });

  it("does not restore a public read policy as rollback", () => {
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+ON public\.notes/);
    expect(migration).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]+TO (PUBLIC|anon|authenticated)/);
  });

  it("fails closed unless the legacy share deadline is explicitly configured", () => {
    expect(legacyShareEdge).toContain('Deno.env.get("LEGACY_SHARE_CUTOFF")');
    expect(legacyShareEdge).not.toMatch(/Date\.parse\("20\d\d-/);
    expect(legacyShareEdge).toContain("legacyShareCutoff:");
    expect(cutoverVerifier).toContain("CAPABILITY_CUTOVER_AT");
    expect(cutoverVerifier).toContain("VITE_LEGACY_SHARE_CUTOFF");
    expect(cutoverVerifier).toContain("CAPABILITY_SHARE_VIEW_URL");
    expect(legacyShareEdge).toMatch(/legacy share compatibility expired[\s\S]+410/);
  });

  it("tombstones legacy share writes at both Edge and SQL boundaries", () => {
    expect(legacyShareCreate).toMatch(/legacy share creation disabled[\s\S]+410/);
    expect(legacyShareCreate).not.toMatch(/legacy_share_rotate|createClient/);
  });

  it("creates capabilities and initial checkpoint in one import transaction", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.capability_note_import_legacy/);
    expect(migration).toMatch(/INSERT INTO public\.notes[\s\S]+INSERT INTO public\.note_capabilities[\s\S]+INSERT INTO public\.note_checkpoints/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.capability_note_import_legacy[\s\S]+TO service_role/);
  });

  it("makes Realtime broadcast read-only when the rollback JWT says writes are disabled", () => {
    expect(migration).toMatch(/Snote editors can send private messages[\s\S]+note_write_disabled/);
  });

  it("sets no-referrer before every precached-shell subresource", () => {
    const policy = appShell.indexOf('<meta name="referrer" content="no-referrer"');
    const firstSubresource = Math.min(
      appShell.indexOf("<link"),
      appShell.indexOf("<script"),
    );
    expect(viteConfig).toContain('navigateFallback: "/index.html"');
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(firstSubresource);
  });
});
