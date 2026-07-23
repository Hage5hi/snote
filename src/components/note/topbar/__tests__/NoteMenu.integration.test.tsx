// Integration test: confirms the Note menu no longer exposes Rename or
// Duplicate actions, and the related i18n keys / helper modules have been
// removed. This is the in-repo counterpart to the E2E spec — it runs in
// CI on every PR (not just when Playwright is available).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { dict } from "@/i18n/catalog";

const RENAME_RE = /rename|đổi tên/i;
const DUP_RE = /duplicate|nhân bản/i;

describe("Note menu — Rename/Duplicate fully removed", () => {
  it("NoteMenu source contains no Rename/Duplicate items or handlers", () => {
    const src = readFileSync(
      resolve(__dirname, "../NoteMenu.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(RENAME_RE);
    expect(src).not.toMatch(DUP_RE);
    expect(src).not.toMatch(/onRename|onDuplicate/);
    // Sanity: expected items still exist.
    expect(src).toMatch(/note\.goal/);
    expect(src).toMatch(/note\.history/);
  });


  it("no rename/duplicate i18n keys remain in any locale", () => {
    for (const [locale, d] of Object.entries(dict)) {
      for (const key of Object.keys(d)) {
        expect(key, `${locale}:${key}`).not.toMatch(/^(rename|dup)\./);
        expect(key, `${locale}:${key}`).not.toMatch(/^note\.(rename|duplicate)/);
      }
    }
  });

  it("rename/duplicate helper modules are gone (dynamic import fails)", async () => {
    // Build specifiers at runtime so TS doesn't try to resolve them.
    const specs = [
      "@/lib/rename",
      "@/components/note/RenameDialog",
      "@/components/note/DuplicateDialog",
    ];
    for (const spec of specs) {
      const loader = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;
      await expect(loader(spec)).rejects.toBeTruthy();
    }
  });
});

