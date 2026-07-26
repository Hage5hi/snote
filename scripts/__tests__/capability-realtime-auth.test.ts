import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyGetUserError,
  MAX_SNOTE_AUTH_CHARS,
  assessVerifiedClaims,
  readSnoteAuthHeader,
} from "../../supabase/functions/_shared/capability-auth.ts";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const ISSUER = "https://project.supabase.co/auth/v1";

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    aud: "authenticated",
    role: "authenticated",
    sub: USER_ID,
    is_anonymous: true,
    iat: 1_000,
    exp: 1_300,
    ...overrides,
  };
}

describe("managed Realtime Auth header", () => {
  it("accepts only a bounded three-part JWT from X-Snote-Auth", () => {
    const token = "a".repeat(10) + "." + "b".repeat(10) + "." + "c".repeat(10);
    expect(readSnoteAuthHeader(new Request("https://example.test", {
      headers: { "x-snote-auth": `  ${token}  ` },
    }))).toBe(token);
    expect(readSnoteAuthHeader(new Request("https://example.test"))).toBeNull();
    expect(readSnoteAuthHeader(new Request("https://example.test", {
      headers: { "x-snote-auth": "not-a-jwt" },
    }))).toBeNull();
    expect(readSnoteAuthHeader(new Request("https://example.test", {
      headers: { "x-snote-auth": `${"a".repeat(MAX_SNOTE_AUTH_CHARS)}.b.c` },
    }))).toBeNull();
  });

  it("accepts a verified anonymous token with a lifetime of exactly 300 seconds", () => {
    expect(assessVerifiedClaims(
      "header.payload.signature",
      validClaims(),
      ISSUER,
      1_001,
    )).toEqual({
      mode: "private-realtime",
      token: "header.payload.signature",
      userId: USER_ID,
      issuedAt: 1_000,
      expiresAt: 1_300,
    });
  });

  it.each([
    ["wrong issuer", { iss: "https://other.example/auth/v1" }],
    ["wrong audience", { aud: "public" }],
    ["wrong role", { role: "anon" }],
    ["non-anonymous", { is_anonymous: false }],
    ["invalid UUID", { sub: "not-a-uuid" }],
    ["future issued-at", { iat: 1_002 }],
    ["expired", { exp: 1_001 }],
    ["overlong lifetime", { exp: 1_301 }],
    ["default one-hour lifetime", { exp: 4_600 }],
    ["zero lifetime", { exp: 1_000 }],
  ])("falls back to polling for %s claims", (_label, overrides) => {
    expect(assessVerifiedClaims(
      "header.payload.signature",
      validClaims(overrides),
      ISSUER,
      1_001,
    )).toEqual({ mode: "polling" });
  });

  it("accepts an audience array containing authenticated", () => {
    expect(assessVerifiedClaims(
      "header.payload.signature",
      validClaims({ aud: ["authenticated", "other"] }),
      ISSUER,
      1_001,
    ).mode).toBe("private-realtime");
  });

  it.each([
    [400, "polling"],
    [429, "polling"],
    [undefined, "polling"],
    ["not-a-status", "polling"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps getUser error status %s to %s", (status, mode) => {
    expect(classifyGetUserError(status)).toEqual({ mode });
  });

});

describe("managed Realtime Edge wiring", () => {
  it("removes the custom signer and uses the platform Auth token", () => {
    const capability = source("supabase/functions/_shared/capability.ts");
    const edge = source("supabase/functions/_shared/capability-edge.ts");
    expect(capability).not.toContain("signRealtimeJwt");
    expect(capability).not.toContain("SUPABASE_JWT_SECRET");
    expect(edge).toContain("verifyRealtimeAuth");
    expect(edge).toContain("capability_realtime_membership_bind");
    expect(edge).toContain("realtimeToken: auth.token");
    expect(edge).toContain('syncTransport: "polling"');
    expect(edge).toContain("x-snote-auth");
    expect(edge).toContain("X-Snote-Auth");
  });

  it("uses the verified Auth user and keeps invalid versus unavailable Auth distinct", () => {
    const edge = source("supabase/functions/_shared/capability-edge.ts");
    expect(edge).toContain("environment.client.auth.getUser(token)");
    expect(edge).toContain("claims.sub !== user.id");
    expect(edge).toContain("is_anonymous");
    expect(edge).toContain("classifyGetUserError");
    expect(edge).toContain('mode: "unavailable"');
    expect(edge).toContain('mode: "polling"');
  });

  it("wires Auth verification and session materialization through every capability endpoint", () => {
    for (const name of ["note-session", "note-sync", "note-manage"]) {
      const endpoint = source(`supabase/functions/${name}/index.ts`);
      expect(endpoint).toContain("verifyRealtimeAuth(req, environment)");
      expect(endpoint).toContain("materializeNoteSession(");
      expect(endpoint).toContain("auth");
    }
    const share = source("supabase/functions/share-view/index.ts");
    const capabilityBranch = share.slice(0, share.indexOf("// Temporary dual-mode compatibility"));
    expect(capabilityBranch).toContain("verifyRealtimeAuth(req, environment)");
    expect(capabilityBranch).toContain("materializeNoteSession(");
    const legacyBranch = share.slice(share.indexOf("// Temporary dual-mode compatibility"));
    expect(legacyBranch).not.toContain("verifyRealtimeAuth");
    expect(legacyBranch).not.toContain("capability_realtime_membership_bind");
  });

  it("does not expose Auth or capability values in response variation or logs", () => {
    const edge = source("supabase/functions/_shared/capability-edge.ts");
    expect(edge).toContain('"Vary": "Authorization, X-Snote-Auth, X-Legacy-Share"');
    const quotaFailure = edge.slice(
      edge.indexOf('if (status === "quota_exceeded")'),
      edge.indexOf('if (status === "invalid"'),
    );
    expect(quotaFailure).toContain("capabilityJson(");
    expect(quotaFailure).toContain('"Retry-After": "3600"');
    expect(quotaFailure).not.toContain("new Response");
    for (const name of ["note-session", "note-sync", "note-manage", "share-view"]) {
      expect(source(`supabase/functions/${name}/index.ts`)).not.toMatch(/console\.(?:log|info|warn|error)/);
    }
  });
});
