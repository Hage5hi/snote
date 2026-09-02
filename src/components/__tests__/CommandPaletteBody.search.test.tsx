import "fake-indexeddb/auto";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommandPaletteBody from "../CommandPaletteBody";
import { hydrateNoteIndex, resetNoteIndexForTests, upsertPlaintextNote } from "@/lib/note-index";
import { touchRecent } from "@/lib/recent-notes";

vi.mock("@/components/ui/command", () => ({
  CommandDialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={() => onOpenChange?.(false)}>
          close-palette
        </button>
        {children}
      </div>
    ) : null,
  CommandInput: ({
    placeholder,
    value,
    onValueChange,
  }: {
    placeholder: string;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <input
      placeholder={placeholder}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandSeparator: () => null,
}));

vi.mock("@/i18n/index", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (!vars) return key;
      return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key);
    },
  }),
}));
vi.mock("lucide-react", () => ({
  FileText: () => null,
  Home: () => null,
  Keyboard: () => null,
  Pin: () => null,
  PinOff: () => null,
  Plus: () => null,
  Search: () => null,
  Shuffle: () => null,
  X: () => null,
}));

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPaletteBody open onOpenChange={vi.fn()} onOpenHelp={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("CommandPaletteBody corpus search", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetNoteIndexForTests();
    await hydrateNoteIndex();
  });

  afterEach(async () => {
    await resetNoteIndexForTests();
    localStorage.clear();
  });

  it("matches title/heading hits from the knowledge index", () => {
    upsertPlaintextNote("recipes", "# Pasta night\nGarlic and oil.\n");
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText("cmdk.placeholder"), {
      target: { value: "pasta" },
    });
    expect(screen.getByText("Pasta night")).toBeInTheDocument();
    expect(screen.getByText(/\/recipes/)).toBeInTheDocument();
    expect(screen.queryByText("/pasta")).not.toBeInTheDocument();
  });

  it("filters to notes whose plaintext contains #tag and does not offer admin", () => {
    upsertPlaintextNote("recipes", "# Pasta\nCook #dinner tonight.\n");
    upsertPlaintextNote("journal", "# Journal\nNo tags here.\n");
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText("cmdk.placeholder"), {
      target: { value: "#dinner" },
    });
    expect(screen.getByText("Pasta")).toBeInTheDocument();
    expect(screen.queryByText("Journal")).not.toBeInTheDocument();
    expect(screen.queryByText(/\/note/)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("/note#tag=");
  });

  it("still offers creating a usable slug when the corpus has no hits", () => {
    upsertPlaintextNote("recipes", "# Pasta\n");
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText("cmdk.placeholder"), {
      target: { value: "brand-new" },
    });
    expect(screen.getByText("/brand-new")).toBeInTheDocument();
    expect(screen.queryByText("Pasta")).not.toBeInTheDocument();
  });

  it("searches recents preview without requiring an indexed body", () => {
    touchRecent("from-home", "unique-preview-token in a recent");
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText("cmdk.placeholder"), {
      target: { value: "unique-preview-token" },
    });
    expect(screen.getByText("/from-home")).toBeInTheDocument();
  });

  it("seeds #tag from a tag chip without a flash of empty query", () => {
    render(
      <MemoryRouter>
        <CommandPaletteBody
          open
          onOpenChange={vi.fn()}
          onOpenHelp={vi.fn()}
          seedQuery="#work"
          seedNonce={1}
        />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText("cmdk.placeholder")).toHaveValue("#work");
  });

  it("does not re-apply a TagChips seed when Cmd-K reopens the palette", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen
          </button>
          <CommandPaletteBody
            open={open}
            onOpenChange={setOpen}
            onOpenHelp={vi.fn()}
            seedQuery="#work"
            seedNonce={1}
          />
        </>
      );
    }
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText("cmdk.placeholder")).toHaveValue("#work");
    fireEvent.click(screen.getByRole("button", { name: "close-palette" }));
    expect(screen.queryByPlaceholderText("cmdk.placeholder")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    expect(screen.getByPlaceholderText("cmdk.placeholder")).toHaveValue("");
  });
});
