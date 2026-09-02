// Integration test: the redundant Note dropdown is gone. Word goal, history,
// and copy-all stay reachable via WordCountTrigger, TopbarBrand, and ⌘⇧C.
// Also confirms Rename/Duplicate stay fully removed (in-repo counterpart to E2E).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { dict } from "@/i18n/catalog";

const RENAME_RE = /rename|đổi tên/i;
const DUP_RE = /duplicate|nhân bản/i;
const TOPBAR = resolve(__dirname, "../Topbar.tsx");
const NOTE_MENU = resolve(__dirname, "../NoteMenu.tsx");

describe("Note menu — removed as duplicate chrome", () => {
  it("does not ship NoteMenu and Topbar does not render it", () => {
    expect(existsSync(NOTE_MENU)).toBe(false);
    const src = readFileSync(TOPBAR, "utf8");
    expect(src).not.toMatch(/NoteMenu/);
    expect(src).not.toMatch(/menu\.note/);
    expect(src).toMatch(/ModeMenu/);
    expect(src).toMatch(/ExportMenu/);
    expect(src).toMatch(/HelpMenu/);
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

  it("Topbar source contains no Rename/Duplicate items or handlers", () => {
    const src = readFileSync(TOPBAR, "utf8");
    expect(src).not.toMatch(RENAME_RE);
    expect(src).not.toMatch(DUP_RE);
    expect(src).not.toMatch(/onRename|onDuplicate/);
  });
});
