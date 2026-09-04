import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const env = import.meta.env as Record<string, unknown>;

describe("Home legacy note navigation", () => {
  let previousFlag: unknown;

  beforeEach(() => {
    previousFlag = env.VITE_CAPABILITY_ROUTES_ENABLED;
    env.VITE_CAPABILITY_ROUTES_ENABLED = "false";
    vi.useFakeTimers();
    sessionStorage.clear();
    Object.values(harness).forEach((mock) => mock.mockReset());
    harness.from.mockReturnValue(query);
    harness.select.mockReturnValue(query);
    harness.eq.mockReturnValue(query);
    harness.abortSignal.mockReturnValue(query);
  });

  afterEach(() => {
    env.VITE_CAPABILITY_ROUTES_ENABLED = previousFlag;
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

  it.each(["note", "Privacy", "S"])(
    "rejects router-owned slug %s before lookup or navigation",
    async (slug) => {
      renderHome();

      fireEvent.change(screen.getByLabelText("home.placeholder"), {
        target: { value: slug },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });

      expect(screen.getByText("home.status.invalid")).toBeInTheDocument();
      expect(harness.from).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));

      expect(screen.getByRole("alert")).toHaveTextContent("home.error.invalid_slug");
      expect(harness.softNavigate).not.toHaveBeenCalled();
    },
  );

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

describe("Home capability mint navigation", () => {
  let previousFlag: unknown;

  function mockCreateNote() {
    const createNote = vi.fn(async (_slug: string, owner: string) => ({
      capabilities: { owner },
      session: { syncTransport: "polling" },
    }));
    harness.createCapabilityApi.mockReturnValue({ createNote });
    return createNote;
  }

  beforeEach(() => {
    previousFlag = env.VITE_CAPABILITY_ROUTES_ENABLED;
    env.VITE_CAPABILITY_ROUTES_ENABLED = "true";
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
    Object.values(harness).forEach((mock) => mock.mockReset());
    harness.from.mockReturnValue(query);
    harness.select.mockReturnValue(query);
    harness.eq.mockReturnValue(query);
    harness.abortSignal.mockReturnValue(query);
  });

  afterEach(() => {
    env.VITE_CAPABILITY_ROUTES_ENABLED = previousFlag;
    sessionStorage.clear();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("mints a free slug via note-session create and navigates to the owner fragment", async () => {
    harness.maybeSingle.mockResolvedValue({ data: null, error: null });
    const createNote = mockCreateNote();
    renderHome();
    await enterValidSlug();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));

    await waitFor(() => {
      expect(createNote).toHaveBeenCalledTimes(1);
    });
    const owner = createNote.mock.calls[0][1];
    expect(owner).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createNote.mock.calls[0][0]).toBe("daily");
    await waitFor(() => {
      expect(harness.softNavigate).toHaveBeenCalledWith(
        expect.any(Function),
        `/daily#owner=${owner}`,
      );
    });
    expect(harness.softNavigate.mock.calls[0][1]).not.toContain("?");
    expect(harness.softNavigate.mock.calls[0][1].split("#")[0]).not.toContain(owner);
    expect(sessionStorage.getItem("snote:pending-owner:daily")).toBeNull();
    expect(JSON.stringify(localStorage.getItem("note.recents"))).not.toContain(owner);
    expect(harness.createLegacyNoteApi).not.toHaveBeenCalled();
  });

  it("opens a legacy taken note without minting or an owner fragment", async () => {
    harness.maybeSingle.mockResolvedValue({
      data: { slug: "daily", char_count: 12 },
      error: null,
    });
    mockCreateNote();
    renderHome();
    await enterValidSlug();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: "home.btn.open_existing" }));

    expect(harness.softNavigate).toHaveBeenCalledWith(expect.any(Function), "/daily");
    expect(harness.softNavigate.mock.calls[0][1]).not.toMatch(/#(?:owner|edit|view)=/);
    expect(harness.createCapabilityApi).not.toHaveBeenCalled();
  });

  it("surfaces slug_unavailable without falling back to a legacy create", async () => {
    harness.maybeSingle.mockResolvedValue({ data: null, error: null });
    const createNote = mockCreateNote();
    createNote.mockRejectedValue({
      status: 409,
      code: "slug_unavailable",
      retryAfterMs: null,
      message: "slug unavailable",
    });
    renderHome();
    await enterValidSlug();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("home.error.slug_unavailable");
    });
    expect(harness.softNavigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("snote:pending-owner:daily")).toBeNull();
    expect(harness.createLegacyNoteApi).not.toHaveBeenCalled();
  });

  it("keeps the pending owner and stays on Home for 503 and 429", async () => {
    harness.maybeSingle.mockResolvedValue({ data: null, error: null });
    const createNote = mockCreateNote();
    createNote.mockRejectedValue({
      status: 503,
      code: "writes_disabled",
      retryAfterMs: null,
      message: "temporarily unavailable",
    });
    renderHome();
    await enterValidSlug();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("home.error.create_unavailable");
    });
    const owner = createNote.mock.calls[0][1];
    expect(sessionStorage.getItem("snote:pending-owner:daily")).toBe(owner);
    expect(harness.softNavigate).not.toHaveBeenCalled();

    createNote.mockReset();
    createNote.mockRejectedValue({
      status: 429,
      code: "rate_limited",
      retryAfterMs: 3_600_000,
      message: "capacity temporarily exceeded",
    });
    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("home.error.create_rate_limited");
    });
    expect(createNote.mock.calls[0][1]).toBe(owner);
    expect(sessionStorage.getItem("snote:pending-owner:daily")).toBe(owner);
    expect(harness.softNavigate).not.toHaveBeenCalled();
  });

  it("retries a lost create with the same persisted owner fragment", async () => {
    harness.maybeSingle.mockResolvedValue({ data: null, error: null });
    const createNote = mockCreateNote();
    createNote.mockRejectedValueOnce({ message: "network lost after commit" });
    renderHome();
    await enterValidSlug();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("home.error.create_failed");
    });
    const owner = createNote.mock.calls[0][1];
    expect(sessionStorage.getItem("snote:pending-owner:daily")).toBe(owner);

    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));
    await waitFor(() => {
      expect(harness.softNavigate).toHaveBeenCalledWith(
        expect.any(Function),
        `/daily#owner=${owner}`,
      );
    });
    expect(createNote.mock.calls[1][1]).toBe(owner);
    expect(sessionStorage.getItem("snote:pending-owner:daily")).toBeNull();
  });

  it("queues a template seed for the minted slug", async () => {
    harness.maybeSingle.mockResolvedValue({ data: null, error: null });
    const createNote = mockCreateNote();
    const { consumeTemplateSeed } = await import("@/lib/note-templates");
    renderHome();
    vi.useRealTimers();

    fireEvent.change(await screen.findByLabelText("home.templates.aria"), {
      target: { value: "meeting" },
    });
    fireEvent.change(screen.getByLabelText("home.placeholder"), {
      target: { value: "daily" },
    });
    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));
    await waitFor(() => {
      expect(createNote).toHaveBeenCalledTimes(1);
    });
    const owner = createNote.mock.calls[0][1];
    await waitFor(() => {
      expect(harness.softNavigate).toHaveBeenCalledWith(
        expect.any(Function),
        `/daily#owner=${owner}`,
      );
    });
    expect(consumeTemplateSeed("daily")).toBe("home.templates.meeting.body");
  });

  it("rejects an invalid slug before minting", async () => {
    mockCreateNote();
    renderHome();

    fireEvent.change(screen.getByLabelText("home.placeholder"), {
      target: { value: "note" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));

    expect(screen.getByRole("alert")).toHaveTextContent("home.error.invalid_slug");
    expect(harness.createCapabilityApi).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("snote:pending-owner:note")).toBeNull();
  });
});

