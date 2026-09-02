import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { resetNoteIndexForTests, upsertPlaintextNote } from "@/lib/note-index";
import { OutlineSidebar } from "../OutlineSidebar";

vi.mock("@/i18n/index", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, string | number>) => {
  if (!vars) return key;
  return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key);
} }) }));
vi.mock("lucide-react", () => ({ X: () => null }));

function Harness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const docRef = useRef(new Y.Doc());
  docRef.current.getText("content").insert(0, "# First heading");
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>Open outline</button>
      <OutlineSidebar
        slug="current"
        doc={docRef.current}
        open={open}
        onOpenChange={setOpen}
        onJump={vi.fn()}
        triggerRef={triggerRef}
      />
    </>
  );
}

describe("OutlineSidebar", () => {
  beforeEach(async () => {
    await resetNoteIndexForTests();
  });

  afterEach(async () => {
    await resetNoteIndexForTests();
  });

  it("keeps a closed drawer out of the accessibility and tab trees", () => {
    const doc = new Y.Doc();
    render(
      <OutlineSidebar
        slug="current"
        doc={doc}
        open={false}
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        triggerRef={createRef<HTMLButtonElement>()}
      />,
    );
    expect(screen.queryByRole("dialog", { name: "brand.outline" })).not.toBeInTheDocument();
  });

  it("focuses the close control, closes on Escape, and restores trigger focus", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open outline" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "brand.outline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "outline.close" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "brand.outline" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("retains the Control/Command plus backslash shortcut", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "brand.outline" })).toBeInTheDocument();
  });

  it("lists clickable backlinks from the local index", () => {
    upsertPlaintextNote("journal", "# Journal\nSee [[current]]");
    const doc = new Y.Doc();
    const onOpenNote = vi.fn();
    render(
      <OutlineSidebar
        slug="current"
        doc={doc}
        open
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        onOpenNote={onOpenNote}
        triggerRef={createRef<HTMLButtonElement>()}
      />,
    );
    expect(screen.getByText("knowledge.backlinks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "knowledge.open_note" }));
    expect(onOpenNote).toHaveBeenCalledWith("journal");
  });
});
