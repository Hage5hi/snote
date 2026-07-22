import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_LOGIN_PASSPHRASE_MAX_CODE_UNITS,
  ADMIN_PASSPHRASE_MAX_BYTES,
  ADMIN_PASSPHRASE_MIN_BYTES,
  isValidAdminLoginPassphrase,
  isValidAdminPassphrase,
} from "../../supabase/functions/_shared/admin-passphrase.ts";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("admin passphrase byte limits", () => {
  it("accepts only 12 through 72 UTF-8 bytes", () => {
    expect(ADMIN_PASSPHRASE_MIN_BYTES).toBe(12);
    expect(ADMIN_PASSPHRASE_MAX_BYTES).toBe(72);

    expect(isValidAdminPassphrase("a".repeat(11))).toBe(false);
    expect(isValidAdminPassphrase("a".repeat(12))).toBe(true);
    expect(isValidAdminPassphrase("a".repeat(72))).toBe(true);
    expect(isValidAdminPassphrase("a".repeat(73))).toBe(false);

    // U+1F512 is four UTF-8 bytes: validate bytes, not JS code units.
    expect(isValidAdminPassphrase("🔒".repeat(18))).toBe(true);
    expect(isValidAdminPassphrase("🔒".repeat(19))).toBe(false);
    expect(isValidAdminPassphrase(null)).toBe(false);
  });

  it("preserves the legacy login boundary while new rotations stay bcrypt-safe", () => {
    expect(ADMIN_LOGIN_PASSPHRASE_MAX_CODE_UNITS).toBe(1024);
    expect(isValidAdminLoginPassphrase("")).toBe(false);
    expect(isValidAdminLoginPassphrase("legacy")).toBe(true);
    expect(isValidAdminLoginPassphrase("a".repeat(1024))).toBe(true);
    expect(isValidAdminLoginPassphrase("a".repeat(1025))).toBe(false);
    expect(isValidAdminLoginPassphrase(null)).toBe(false);
  });

  it("uses separate shared validators for legacy login and new rotation", () => {
    const session = source("supabase/functions/admin-session/index.ts");
    const rotate = source("supabase/functions/admin-rotate/index.ts");
    const dialog = source("src/components/admin/RotatePassDialog.tsx");

    expect(session).toContain("isValidAdminLoginPassphrase");
    expect(session).not.toContain(".slice(0, 1024)");
    expect(session).toMatch(
      /const verified = passphraseValid[\s\S]*?verifyAdminPass\(supabase, passphrase\)[\s\S]*?: \{ available: true as const, valid: false as const \}/,
    );

    expect(rotate).toContain("isValidAdminPassphrase");
    expect(rotate).toContain("12 and 72 UTF-8 bytes");
    expect(rotate).not.toContain("newPass.length");

    expect(dialog).toContain("isValidAdminPassphrase");
    expect(dialog).toContain("12–72 UTF-8 bytes");
    expect(dialog).toContain('t("admin.rotate.invalid_length")');
    expect(dialog).not.toContain('t("admin.rotate.too_short")');
    expect(dialog).not.toContain("newPass.length < 12");
    expect(dialog).not.toContain("minLength={12}");
  });

  it("documents the legacy login bound separately from the rotation policy", () => {
    const findings = source("docs/security-findings.md");

    expect(findings).toContain("1,024 JavaScript code units");
    expect(findings).toContain("Newly rotated passphrases alone enforce");
    expect(findings).toContain("12–72 UTF-8-byte bcrypt policy");
  });
});
