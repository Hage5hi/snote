import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../Home";
import { upsertCollection } from "@/lib/home-library";
import {
  hydrateNoteIndex,
  rememberMetadata,
  resetNoteIndexForTests,
  upsertPlaintextNote,
  whenNoteIndexIdle,
} from "@/lib/note-index";
import { consumeTemplateSeed } from "@/lib/note-templates";
import { togglePin, touchRecent } from "@/lib/recent-notes";

const harness = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  abortSignal: vi.fn(),
  maybeSingle: vi.fn(),
  softNavigate: vi.fn(),
  createCapabilityApi: vi.fn(),
  createLegacyNoteApi: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => harness.from(...args),
  },
}));
vi.mock("@/lib/soft-navigate", () => ({
  softNavigate: (...args: unknown[]) => {
    harness.softNavigate(...args);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/capability/client", () => ({
  createCapabilityApi: (...args: unknown[]) => harness.createCapabilityApi(...args),
}));
vi.mock("@/lib/legacy/cutover", () => ({
  createLegacyNoteApi: (...args: unknown[]) => harness.createLegacyNoteApi(...args),
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/SceneToggle", () => ({ SceneToggle: () => null }));
vi.mock("@/components/LanguageToggle", () => ({ LanguageToggle: () => null }));
vi.mock("@/components/note/InstallPrompt", () => ({ InstallPrompt: () => null }));
vi.mock("@/components/home/SceneHost", () => ({ default: () => null }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/hooks/use-scene-theme", () => ({
  useSceneTheme: () => ({
    scene: "none",
    committedScene: "none",
    setScene: vi.fn(),
  }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (!vars) return key;
      return key.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
    },
  }),
}));
vi.mock("@/lib/ext-context", () => ({ isExtensionContext: true }));

const query = {
  select: harness.select,
  eq: harness.eq,
  abortSignal: harness.abortSignal,
  maybeSingle: harness.maybeSingle,
};

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

describe("Home knowledge library", () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    Object.values(harness).forEach((mock) => mock.mockReset());
    harness.from.mockReturnValue(query);
    harness.select.mockReturnValue(query);
    harness.eq.mockReturnValue(query);
    harness.abortSignal.mockReturnValue(query);
    harness.maybeSingle.mockResolvedValue({ data: null, error: null });
    await resetNoteIndexForTests();
  });

  afterEach(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    await resetNoteIndexForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("filters recents and pins by index tags and fails closed for metadata-only notes", async () => {
    touchRecent("tagged");
    touchRecent("plain");
    togglePin("tagged");
    togglePin("secret");
    upsertPlaintextNote("tagged", "hello #work");
    rememberMetadata("plain");
    rememberMetadata("secret");
    await hydrateNoteIndex();

    renderHome();
    expect((await screen.findAllByText("/tagged")).length).toBeGreaterThan(0);
    expect(screen.getByText("/plain")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("home.filter.aria"), {
      target: { value: "#work" },
    });

    expect(screen.getAllByText("/tagged").length).toBeGreaterThan(0);
    expect(screen.queryByText("/plain")).not.toBeInTheDocument();
    expect(screen.queryByText("/secret")).not.toBeInTheDocument();
    expect(JSON.stringify(localStorage.getItem("note.recents"))).not.toContain("hello #work");
  });

  it("hydrates index tags from knowledge IDB so Home can filter after a reload", async () => {
    touchRecent("tagged");
    touchRecent("plain");
    upsertPlaintextNote("tagged", "hello #work", { durable: true });
    upsertPlaintextNote("plain", "no tags here", { durable: true });
    await whenNoteIndexIdle();
    await resetNoteIndexForTests({ dropDatabase: false });

    renderHome();
    fireEvent.change(await screen.findByLabelText("home.filter.aria"), {
      target: { value: "#work" },
    });
    await waitFor(() => {
      expect(screen.getAllByText("/tagged").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("/plain")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "home.filter.chip_aria" })).toBeInTheDocument();
  });

  it("saves, applies, and deletes a local virtual collection", async () => {
    touchRecent("tagged");
    upsertPlaintextNote("tagged", "hello #work");
    await hydrateNoteIndex();
    upsertCollection({ name: "Work", tags: ["work"] });

    renderHome();
    expect(await screen.findByText("/tagged")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.getByLabelText("home.filter.aria")).toHaveValue("#work");
    expect(screen.getByText("/tagged")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "home.collections.delete_aria" }));
    expect(screen.queryByRole("button", { name: "Work" })).not.toBeInTheDocument();
    expect(localStorage.getItem("note.collections")).toBe("[]");
  });

  it("opens a templated slug at /slug with a markdown seed and no capability mint", async () => {
    renderHome();
    await act(async () => {
      await hydrateNoteIndex();
    });

    fireEvent.change(screen.getByLabelText("home.templates.aria"), {
      target: { value: "meeting" },
    });
    fireEvent.change(screen.getByLabelText("home.placeholder"), {
      target: { value: "daily" },
    });
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));

    expect(harness.softNavigate).toHaveBeenCalledWith(expect.any(Function), "/daily");
    expect(harness.softNavigate.mock.calls[0][1]).not.toMatch(/#(?:owner|edit|view)=/);
    expect(harness.createCapabilityApi).not.toHaveBeenCalled();
    expect(harness.createLegacyNoteApi).not.toHaveBeenCalled();
    expect(consumeTemplateSeed("daily")).toBe("home.templates.meeting.body");
  });
});
