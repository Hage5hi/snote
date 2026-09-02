import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import CommandPaletteBody from "../CommandPaletteBody";

vi.mock("@/components/ui/command", () => ({
  CommandDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
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

vi.mock("@/lib/note-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/note-index")>();
  return {
    ...actual,
    hydrateNoteIndex: () => Promise.resolve(),
    isNoteIndexHydrated: () => true,
  };
});
vi.mock("@/lib/recent-notes", () => ({
  getPinned: () => [],
  getRecents: () => [],
  togglePin: () => [],
}));
vi.mock("@/i18n/index", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
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

describe("CommandPaletteBody slug validation", () => {
  it.each(["note", "Privacy", "S"])("does not offer router-owned slug %s", (slug) => {
    renderPalette();

    fireEvent.change(screen.getByPlaceholderText("cmdk.placeholder"), {
      target: { value: slug },
    });

    expect(screen.queryByText(`/${slug}`)).not.toBeInTheDocument();
  });

  it("still offers an ordinary note slug", () => {
    renderPalette();

    fireEvent.change(screen.getByPlaceholderText("cmdk.placeholder"), {
      target: { value: "daily" },
    });

    expect(screen.getByText("/daily")).toBeInTheDocument();
  });
});
