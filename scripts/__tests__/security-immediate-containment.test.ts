import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  const absolutePath = resolve(process.cwd(), path);
  expect(existsSync(absolutePath), `${path} must exist`).toBe(true);
  return readFileSync(absolutePath, "utf8");
}

describe("immediate containment contracts", () => {
  it("lets admins delete every persisted legacy slug accepted by note metadata", () => {
    const adminDelete = source("supabase/functions/admin-delete/index.ts");

    expect(adminDelete).toContain("const SLUG_RE = /^[A-Za-z0-9._-]{1,80}$/;");
  });

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

  it("serializes admin verification and failure recording in SQL", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_auth_begin/i,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_auth_complete/i,
    );
    expect(migration).toMatch(/ON CONFLICT \(subject_hash\) DO UPDATE/i);
    expect(migration).toMatch(/lease_id[\s\S]*lease_until/i);
    expect(migration).toMatch(/FOR UPDATE/i);
    expect(migration).toMatch(/RENAME COLUMN ip TO subject_hash/i);
    expect(migration).toMatch(/TRUNCATE TABLE public\.admin_auth_attempts/i);
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_auth_begin[\s\S]*FROM PUBLIC, anon, authenticated/i,
    );

    const limiter = source("supabase/functions/_shared/admin-rate-limit.ts");
    expect(limiter).toContain('.rpc("admin_auth_begin"');
    expect(limiter).toContain('.rpc("admin_auth_complete"');
    expect(limiter).not.toContain('.select("failure_count');
    expect(limiter).not.toContain('.update(update)');
  });

  it("hardens every privileged function against public-schema name shadowing", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const privilegedFunctions = migration.match(/SECURITY DEFINER/g) ?? [];
    const hardenedSearchPaths = migration.match(
      /SECURITY DEFINER\s+SET search_path = pg_catalog, pg_temp/g,
    ) ?? [];

    expect(privilegedFunctions.length).toBeGreaterThan(0);
    expect(hardenedSearchPaths).toHaveLength(privilegedFunctions.length);
    expect(migration).not.toMatch(/SECURITY DEFINER\s+SET search_path = public/i);
  });

  it("fails closed when rate-limit or session storage is unavailable", () => {
    const limiter = source("supabase/functions/_shared/admin-rate-limit.ts");
    expect(limiter).toContain("serviceUnavailableResponse");
    expect(limiter).toMatch(/if \(error\)[\s\S]*available: false/);

    const auth = source("supabase/functions/_shared/admin-auth.ts");
    expect(auth).toContain("serviceUnavailableResponse");
    expect(auth).toMatch(/if \(error\)[\s\S]*unavailable/);

    for (const name of ["admin-list", "admin-delete", "admin-rotate"]) {
      const consumer = source(`supabase/functions/${name}/index.ts`);
      expect(consumer, name).toContain("authorizeAdminSession");
      expect(consumer, name).toContain("adminAuthResponse");
    }
  });

  it("keeps admin list and delete authorization atomic with each note action", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_notes_list[\s\S]*?FOR SHARE/i,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_notes_delete[\s\S]*?FOR SHARE/i,
    );
    for (const rpc of ["admin_notes_list", "admin_notes_delete"]) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${rpc}[\\s\\S]*?FROM PUBLIC, anon, authenticated`,
          "i",
        ),
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}[\\s\\S]*?TO service_role`, "i"),
      );
    }

    const list = source("supabase/functions/admin-list/index.ts");
    expect(list).toContain('.rpc("admin_notes_list"');
    expect(list).not.toContain('.from("notes")');

    const remove = source("supabase/functions/admin-delete/index.ts");
    expect(remove).toContain('.rpc("admin_notes_delete"');
    expect(remove).not.toContain('.from("notes")');
  });

  it("builds admin list totals and page items from one statement snapshot", () => {
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );
    const listFunction = migration.match(
      /CREATE OR REPLACE FUNCTION public\.admin_notes_list[\s\S]*?\n\$\$;/i,
    )?.[0];

    expect(listFunction).toBeDefined();
    expect(listFunction).toMatch(/WITH filtered AS MATERIALIZED/i);
    expect(listFunction).toMatch(/page_keys AS[\s\S]*?FROM filtered/i);
    expect(listFunction).toMatch(
      /page AS[\s\S]*?FROM page_keys[\s\S]*?JOIN public\.notes AS notes USING \(slug\)/i,
    );
    expect(listFunction).toMatch(
      /SELECT\s+count\(\*\)[\s\S]*?jsonb_agg[\s\S]*?INTO v_total, v_items[\s\S]*?FROM filtered/i,
    );
  });

  it("derives a privacy-preserving client key only from strict Cloudflare client IP", () => {
    const auth = source("supabase/functions/_shared/admin-auth.ts");
    expect(auth).toContain('headers.get("cf-connecting-ip")');
    expect(auth).toContain('rawIp.includes(",")');
    for (const header of [
      "sb-forwarded-for",
      "x-forwarded-for",
      "x-real-ip",
      "true-client-ip",
      "x-envoy-external-address",
    ]) {
      expect(auth).not.toContain(`headers.get("${header}")`);
    }
    expect(auth).toContain('Deno.env.get("ADMIN_RATE_LIMIT_HMAC_SECRET")');
    expect(auth).toContain('crypto.subtle.importKey("raw"');
    expect(auth).toContain('crypto.subtle.sign("HMAC"');
  });

  it("tombstones destructive cleanup while note metadata remains client-controlled", () => {
    const cleanup = source("supabase/functions/cleanup/index.ts");
    const panel = source("src/pages/AdminPanel.tsx");

    expect(cleanup).toMatch(/status:\s*410/);
    expect(cleanup).toContain('"Cache-Control": "no-store"');
    expect(cleanup).toContain('"CDN-Cache-Control": "no-store"');
    expect(cleanup).toContain('error: "endpoint retired"');
    expect(cleanup).not.toContain("createClient");
    expect(cleanup).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(cleanup).not.toContain('.from("notes")');
    expect(cleanup).not.toContain(".delete(");
    expect(panel).not.toContain('functions.invoke("cleanup"');
    expect(panel).not.toContain("Clean empty notes");
  });

  it("tombstones share-rename without initializing or calling the database", () => {
    const rename = source("supabase/functions/share-rename/index.ts");
    expect(rename).toMatch(/status:\s*410/);
    expect(rename).toContain('"Cache-Control": "no-store"');
    expect(rename).toContain('"CDN-Cache-Control": "no-store"');
    expect(rename).toContain('error: "endpoint retired"');
    expect(rename).not.toContain("createClient");
    expect(rename).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(rename).not.toContain('.from("notes")');
    expect(rename).not.toContain('.from("note_shares")');
  });

  it("tombstones the unauthenticated old-slug cleanup observer without locator logs", () => {
    const observer = source(
      "supabase/functions/old-slug-cleanup-status/index.ts",
    );
    expect(observer).toMatch(/status:\s*410/);
    expect(observer).toContain('"Cache-Control": "no-store"');
    expect(observer).toContain('"CDN-Cache-Control": "no-store"');
    expect(observer).toContain('error: "endpoint retired"');
    expect(observer).not.toContain("createClient");
    expect(observer).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(observer).not.toContain('.from("notes")');
    expect(observer).not.toMatch(/console\.(?:log|warn|error)/);
    expect(observer).not.toContain("body?.slug");
    expect(observer).not.toContain("body?.newSlug");
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
    expect(session).toContain('.rpc("admin_session_issue"');
    expect(session).not.toContain('.from("admin_sessions").insert');
    expect(session).toContain('"Cache-Control": "no-store"');
    expect(session).toContain("ADMIN_SESSION_TTL_MINUTES");

    for (const name of ["admin-list", "admin-delete", "admin-rotate"]) {
      const consumer = source(`supabase/functions/${name}/index.ts`);
      expect(consumer, name).not.toMatch(
        /body\?\.passphrase|verifyAdminPass|bcrypt\.compare/,
      );
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

  it("expires cached admin data exactly and purges it on unauthorized API responses", () => {
    const panel = source("src/pages/AdminPanel.tsx");

    expect(panel).toContain("SESSION_EXPIRY_KEY");
    expect(panel).toContain("parseSessionExpiry");
    expect(panel).toMatch(
      /if \(error \|\| !data\?\.sessionToken \|\| !data\?\.expiresAt\)[\s\S]*?unauthorized/,
    );
    expect(panel).toMatch(
      /sessionStorage\.setItem\(SESSION_EXPIRY_KEY, expiresAt\)/,
    );

    const purgeSession = panel.match(
      /const purgeAdminState = useCallback\([\s\S]*?\n  \);/,
    )?.[0] ?? "";
    expect(purgeSession).not.toBe("");
    expect(purgeSession).toContain("sessionStorage.removeItem(SESSION_TOKEN_KEY)");
    expect(purgeSession).toContain("sessionStorage.removeItem(SESSION_EXPIRY_KEY)");
    expect(purgeSession).toContain("setSessionToken(\"\")");
    expect(purgeSession).toContain("setItems([])");
    expect(purgeSession).toContain("setTotal(0)");
    expect(purgeSession).toContain("setTopTags([])");
    expect(purgeSession).toContain("setSelected(new Set())");

    const scheduleExpiry = panel.match(
      /const scheduleSessionExpiry = useCallback\([\s\S]*?\n  \);/,
    )?.[0] ?? "";
    expect(scheduleExpiry).not.toBe("");
    expect(scheduleExpiry).toContain("window.setTimeout");
    expect(scheduleExpiry).toContain("clearAdminSession()");

    const ownership = panel.match(
      /const requestOwnership = useCallback\([\s\S]*?\n  \);/,
    )?.[0] ?? "";
    expect(ownership).not.toBe("");
    expect(ownership).toContain("sessionGenerationRef.current !== generation");
    expect(ownership).toContain("activeSessionTokenRef.current !== token");
    expect(ownership).toContain("readStoredSessionToken()");
    expect(ownership).toContain('? "superseded"');

    const beginRequest = panel.match(
      /const beginAdminRequest = useCallback\([\s\S]*?\n  \);/,
    )?.[0] ?? "";
    expect(beginRequest).not.toBe("");
    expect(beginRequest).toContain("storedSessionIsCurrent(token)");
    expect(beginRequest).toContain("retireStaleAdminView()");

    const fetchList = panel.match(
      /const fetchList = useCallback\([\s\S]*?\n  \);/,
    )?.[0] ?? "";
    expect(fetchList).not.toBe("");
    expect(fetchList).toContain("beginAdminRequest(token)");
    expect(fetchList).toContain("requestOwnership(token, requestGeneration)");
    expect(fetchList).toContain('ownership === "stale"');
    expect(fetchList).toContain('ownership === "superseded"');
    expect(fetchList).toContain("retireStaleAdminView()");
    expect(fetchList).toContain("isUnauthorizedAdminResponse(error, data)");
    expect(fetchList).toContain("clearRejectedSession(token, requestGeneration)");
    expect(fetchList.indexOf('ownership === "stale"')).toBeLessThan(
      fetchList.indexOf("isUnauthorizedAdminResponse(error, data)"),
    );

    const deleteHandler = panel.match(
      /const doDelete = async[\s\S]*?\n  \};/,
    )?.[0] ?? "";
    expect(deleteHandler).not.toBe("");
    expect(deleteHandler).toContain("beginAdminRequest(sessionToken)");
    expect(deleteHandler).toContain("isUnauthorizedAdminResponse(error, data)");
    expect(deleteHandler).toContain(
      "clearRejectedSession(sessionToken, requestGeneration)",
    );

    expect(panel).toContain('window.addEventListener("focus", revalidate)');
    expect(panel).toContain('window.addEventListener("pageshow", revalidate)');
    expect(panel).toContain(
      'document.addEventListener("visibilitychange", revalidate)',
    );
  });

  it("keeps legacy fail-open admin endpoints disabled across the schema transition", () => {
    const rollout = source("docs/security/immediate-containment-rollout.md");
    const migration = source(
      "supabase/migrations/20260719000000_security_immediate_containment.sql",
    );

    const disableLegacyAt = rollout.indexOf(
      "Disable or tombstone the legacy admin, `cleanup`, and",
    );
    const applyContainmentAt = rollout.indexOf(
      "Apply `20260719000000_security_immediate_containment.sql`",
    );
    const enableReplacementAt = rollout.indexOf(
      "Enable only the replacement admin endpoints",
    );

    expect(disableLegacyAt).toBeGreaterThan(-1);
    expect(applyContainmentAt).toBeGreaterThan(disableLegacyAt);
    expect(enableReplacementAt).toBeGreaterThan(applyContainmentAt);
    expect(rollout).toMatch(/The cleanup endpoint\s+remains tombstoned/);
    expect(migration).toContain(
      "Disable or tombstone the legacy admin and cleanup Edge endpoints before applying this migration",
    );
  });

  it("covers every canonical share host and blocks direct-origin bypass before rollout", () => {
    const worker = source("cloudflare-worker/worker.js");
    const readme = source("cloudflare-worker/README.md");
    const rollout = source("docs/security/immediate-containment-rollout.md");

    expect(worker).toContain("note.syrin.online/*");
    expect(worker).toContain(
      'const APPROVED_CANONICAL_ORIGIN = "https://note.syrin.online";',
    );
    expect(worker).toContain(
      "const raw = env?.SITE_URL ?? APPROVED_CANONICAL_ORIGIN;",
    );
    expect(readme).toContain(
      '{ pattern = "note.syrin.online/*", zone_name = "syrin.online" }',
    );
    expect(readme).toContain("SITE_URL = \"https://note.syrin.online\"");
    expect(readme).toMatch(
      /## Rollback[\s\S]*generic containment[\s\S]*`\/s\/\*`/,
    );
    expect(readme).not.toContain("traffic trở lại pass-through 100%");
    expect(rollout).toContain("Inventory every live share hostname and direct origin alias");
    expect(rollout).toContain("note.syrin.online");
    expect(rollout).toContain("snote.lovable.app");
    expect(rollout).toContain(
      "Do not advance while any public alias can bypass the generic share response",
    );
  });

  it("keeps the executable Worker containment suite inside the default unit gate", () => {
    const config = source("vitest.config.ts");

    expect(config).toContain('"cloudflare-worker/**/*.{test,spec}.{ts,tsx}"');
  });

  it("disables platform request traces that can capture legacy capability paths", () => {
    const wrangler = source("cloudflare-worker/wrangler.toml");
    const readme = source("cloudflare-worker/README.md");
    const rollout = source("docs/security/immediate-containment-rollout.md");

    expect(wrangler).toMatch(
      /\[observability\.logs\][\s\S]*?invocation_logs\s*=\s*false/,
    );
    expect(wrangler).toMatch(
      /\[observability\.traces\][\s\S]*?enabled\s*=\s*false/,
    );
    expect(readme).toContain("[observability.traces]");
    expect(rollout).toContain("[observability.traces] enabled = false");
  });
});
