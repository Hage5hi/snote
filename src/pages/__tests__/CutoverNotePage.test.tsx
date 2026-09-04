import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CutoverNotePage } from "../CutoverNotePage";

const OWNER = "o".repeat(43);
const EDIT = "e".repeat(43);

const harness = vi.hoisted(() => ({
  notesFrom: vi.fn(),
  notePage: [] as Array<Record<string, unknown>>,
  legacyPage: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      harness.notesFrom(table);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: vi.fn(),
      };
    },
  },
}));

vi.mock("@/pages/NotePage", () => ({
  default: (props: Record<string, unknown>) => {
    harness.notePage.push(props);
    return <div>note-page:{String(props.embedSlug ?? "route")}</div>;
  },
}));

vi.mock("@/pages/LegacyNotePage", () => ({
  default: (props: { slug: string; embed?: boolean }) => {
    harness.legacyPage.push(props);
    return <div>legacy-page:{props.slug}{props.embed ? ":embed" : ""}</div>;
  },
}));

vi.mock("@/lib/legacy/cutover", () => ({
  clearLegacyImportRecovery: vi.fn(),
}));

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug" element={<CutoverNotePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CutoverNotePage canary dispatch", () => {
  beforeEach(() => {
    harness.notesFrom.mockClear();
    harness.notePage.length = 0;
    harness.legacyPage.length = 0;
  });

  it("lazy-loads LegacyNotePage for a plain slug without a capability fragment", async () => {
    renderRoute("/daily");

    expect(await screen.findByText("legacy-page:daily")).toBeInTheDocument();
    expect(screen.queryByText("note-page:route")).not.toBeInTheDocument();
    expect(harness.notePage).toHaveLength(0);
    expect(harness.notesFrom).not.toHaveBeenCalled();
    expect(harness.notesFrom).not.toHaveBeenCalledWith("notes");
  });

  it("renders NotePage for a matching #owner fragment", async () => {
    renderRoute(`/daily#owner=${OWNER}`);

    expect(await screen.findByText("note-page:route")).toBeInTheDocument();
    expect(screen.queryByText(/legacy-page:/)).not.toBeInTheDocument();
    expect(harness.legacyPage).toHaveLength(0);
  });

  it("renders NotePage for a matching #edit fragment", async () => {
    renderRoute(`/daily#edit=${EDIT}`);

    expect(await screen.findByText("note-page:route")).toBeInTheDocument();
    expect(screen.queryByText(/legacy-page:/)).not.toBeInTheDocument();
  });

  it("uses LegacyNotePage for an embedded plain slug", async () => {
    render(
      <MemoryRouter initialEntries={["/alpha+beta"]}>
        <CutoverNotePage embedSlug="alpha" embedNarrow onPrimaryScroller={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByText("legacy-page:alpha:embed")).toBeInTheDocument();
    expect(harness.notePage).toHaveLength(0);
    expect(harness.notesFrom).not.toHaveBeenCalled();
  });
});
