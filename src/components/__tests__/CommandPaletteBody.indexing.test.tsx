import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/note-index", () => ({
  hydrateNoteIndex: () => new Promise(() => {}),
  isNoteIndexHydrated: () => false,
  subscribeNoteIndex: () => () => {},
}));

vi.mock("@/lib/knowledge-search", () => ({
  collectKnowledgeSearchDocs: () => [],
  parseKnowledgeQuery: () => ({ raw: "", text: "", tag: null }),
  rankKnowledgeSearch: () => [],
}));

vi.mock("@/components/ui/command", () => ({
  CommandDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  CommandInput: ({ placeholder }: { placeholder: string }) => <input placeholder={placeholder} />,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandSeparator: () => null,
}));
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
  Shuffle: () => null,
}));

describe("CommandPaletteBody indexing state", () => {
  it("shows a one-line indexing hint instead of a spinner wall", async () => {
    const { default: CommandPaletteBody } = await import("../CommandPaletteBody");
    render(
      <MemoryRouter>
        <CommandPaletteBody open onOpenChange={vi.fn()} onOpenHelp={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("cmdk.indexing")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("cmdk.empty")).not.toBeInTheDocument();
  });
});
