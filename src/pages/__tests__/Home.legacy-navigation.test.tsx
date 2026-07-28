import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../Home";

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
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/ext-context", () => ({ isExtensionContext: true }));
vi.mock("@/lib/recent-notes", () => ({
  getPinned: () => [],
  getRecents: () => [{ slug: "recent", lastOpenedAt: Date.now() }],
  removeRecent: () => [],
  togglePin: () => [],
}));
vi.mock("lucide-react", () => ({
  ArrowRight: () => null,
  Check: () => null,
  Loader2: () => null,
  Shuffle: () => null,
  Star: () => null,
  Trash2: () => null,
}));

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

async function enterValidSlug(slug = "daily") {
  fireEvent.change(screen.getByLabelText("home.placeholder"), {
    target: { value: slug },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

describe("Home legacy note navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    Object.values(harness).forEach((mock) => mock.mockReset());
    harness.from.mockReturnValue(query);
    harness.select.mockReturnValue(query);
    harness.eq.mockReturnValue(query);
    harness.abortSignal.mockReturnValue(query);
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it.each([
    ["available", null, "home.status.available"],
    ["taken", { slug: "daily", char_count: 12 }, "home.status.taken"],
  ])("marks an exact legacy lookup as %s", async (_label, data, statusKey) => {
    harness.maybeSingle.mockResolvedValue({ data, error: null });
    renderHome();

    await enterValidSlug();

    expect(harness.from).toHaveBeenCalledWith("notes");
    expect(harness.select).toHaveBeenCalledWith("slug, char_count");
    expect(harness.eq).toHaveBeenCalledWith("slug", "daily");
    expect(harness.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(harness.maybeSingle).toHaveBeenCalledTimes(1);
    expect(screen.getByText(statusKey)).toBeInTheDocument();
  });

  it("submits a valid slug directly through softNavigate without Edge APIs", async () => {
    harness.maybeSingle.mockResolvedValue({ data: null, error: null });
    renderHome();
    await enterValidSlug();

    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));

    expect(harness.softNavigate).toHaveBeenCalledWith(expect.any(Function), "/daily");
    expect(harness.createCapabilityApi).not.toHaveBeenCalled();
    expect(harness.createLegacyNoteApi).not.toHaveBeenCalled();
  });

  it("keeps direct navigation available when the optional lookup fails", async () => {
    harness.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "network unavailable" },
    });
    renderHome();
    await enterValidSlug();

    const openButton = screen.getByRole("button", { name: "home.btn.open" });
    expect(openButton).toBeEnabled();
    fireEvent.click(openButton);

    expect(harness.softNavigate).toHaveBeenCalledWith(expect.any(Function), "/daily");
  });

  it("does not fetch or cache plaintext snapshots when a recent note is hovered", async () => {
    harness.maybeSingle.mockResolvedValue({
      data: { ydoc_state: "plaintext-snapshot", is_encrypted: false },
      error: null,
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderHome();

    fireEvent.mouseEnter(screen.getByText("/recent").closest("li")!);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.from).not.toHaveBeenCalled();
    expect(setItem.mock.calls.some(([key]) => String(key).startsWith("note-snapshot:"))).toBe(false);
    expect(sessionStorage.getItem("note-snapshot:recent")).toBeNull();
    expect(harness.createCapabilityApi).not.toHaveBeenCalled();
    expect(harness.createLegacyNoteApi).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
