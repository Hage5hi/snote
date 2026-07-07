// Integration test: confirms the Note menu no longer exposes Rename or
// Duplicate actions, and the related i18n keys / helper modules have been
// removed. This is the in-repo counterpart to the E2E spec — it runs in
// CI on every PR (not just when Playwright is available).
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/i18n/provider";
import { translations } from "@/i18n";
import { NoteMenu } from "../NoteMenu";

const RENAME_RE = /rename|đổi tên/i;
const DUP_RE = /duplicate|nhân bản/i;

function renderMenu() {
  return render(
    <I18nProvider>
      <NoteMenu onOpenGoal={() => {}} onOpenHistory={() => {}} onCopyAll={() => {}} />
    </I18nProvider>,
  );
}

describe("Note menu — Rename/Duplicate fully removed", () => {
  it("dropdown does not surface Rename or Duplicate menu items", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /note/i }));
    expect(screen.queryByRole("menuitem", { name: RENAME_RE })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: DUP_RE })).toBeNull();
    // Sanity: expected items still exist.
    expect(screen.getByRole("menuitem", { name: /goal/i })).toBeInTheDocument();
  });

  it("no rename/duplicate i18n keys remain in any locale", () => {
    for (const [locale, dict] of Object.entries(translations)) {
      for (const key of Object.keys(dict)) {
        expect(key, `${locale}:${key}`).not.toMatch(/^(rename|dup)\./);
        expect(key, `${locale}:${key}`).not.toMatch(/^note\.(rename|duplicate)/);
      }
    }
  });

  it("rename/duplicate helper modules are gone (dynamic import 404)", async () => {
    await expect(import(/* @vite-ignore */ "@/lib/rename")).rejects.toBeTruthy();
    await expect(
      import(/* @vite-ignore */ "@/components/note/RenameDialog"),
    ).rejects.toBeTruthy();
    await expect(
      import(/* @vite-ignore */ "@/components/note/DuplicateDialog"),
    ).rejects.toBeTruthy();
  });
});
