// Auto-extracts every `install.*` key referenced by InstallPrompt.tsx and
// asserts each locale dictionary has a non-empty string for it. Prevents
// silent fallback to the raw key text in any of the 9 shipped locales.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPPORTED_LANGS } from "@/i18n";
import { dict } from "@/i18n/catalog";

const SRC = resolve(__dirname, "../../components/note/InstallPrompt.tsx");

function extractInstallKeys(): string[] {
  const src = readFileSync(SRC, "utf8");
  const re = /["']install\.([a-z0-9_]+)["']/g;
  const set = new Set<string>();
  for (const m of src.matchAll(re)) set.add(`install.${m[1]}`);
  return [...set].sort();
}

describe("InstallPrompt i18n key coverage", () => {
  const keys = extractInstallKeys();

  it("extracts at least the known status + step keys", () => {
    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(keys).toContain("install.status_installed_label");
    expect(keys).toContain("install.step_completed");
    expect(keys).toContain("install.ext_step_loadunpacked");
  });

  for (const lang of SUPPORTED_LANGS) {
    it(`locale "${lang}" defines every install.* key`, () => {
      const d = dict[lang] as Record<string, string>;
      const missing: string[] = [];
      const empty: string[] = [];
      for (const k of keys) {
        if (!(k in d)) missing.push(k);
        else if (typeof d[k] !== "string" || d[k].trim() === "") empty.push(k);
      }
      expect(
        { lang, missing, empty },
        `locale ${lang} is missing/empty install keys`,
      ).toEqual({ lang, missing: [], empty: [] });
    });
  }
});
