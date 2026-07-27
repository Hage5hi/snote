import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { OutlineSidebar } from "../OutlineSidebar";

vi.mock("@/i18n/index", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
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
  it("keeps a closed drawer out of the accessibility and tab trees", () => {
    const doc = new Y.Doc();
    render(
      <OutlineSidebar
        doc={doc}
        open={false}
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        triggerRef={createRef<HTMLButtonElement>()}
      />,
    );
    expect(screen.queryByRole("dialog", { name: "Outline" })).not.toBeInTheDocument();
  });

  it("focuses the close control, closes on Escape, and restores trigger focus", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open outline" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Outline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "outline.close" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Outline" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("retains the Control/Command plus backslash shortcut", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Outline" })).toBeInTheDocument();
  });
});
