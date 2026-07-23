import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Home from "../Home";

vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/SceneToggle", () => ({ SceneToggle: () => null }));
vi.mock("@/components/LanguageToggle", () => ({ LanguageToggle: () => null }));
vi.mock("@/components/note/InstallPrompt", () => ({ InstallPrompt: () => null }));
vi.mock("@/components/home/SceneHost", () => ({ default: () => null }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
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
  getPinned: () => ["pinned"],
  getRecents: () => [{ slug: "recent", lastOpenedAt: Date.now() }],
  removeRecent: () => [],
  togglePin: () => [],
}));
vi.mock("@/lib/capability/client", () => ({
  createCapabilityApi: () => ({ createNote: vi.fn() }),
}));
vi.mock("@/lib/capability/url", () => ({ buildCapabilityUrl: vi.fn() }));
vi.mock("@/lib/legacy/cutover", () => ({
  createLegacyNoteApi: () => ({ exists: vi.fn(async () => false) }),
}));
vi.mock("lucide-react", () => ({
  ArrowRight: () => null,
  Check: () => null,
  Loader2: () => null,
  Shuffle: () => null,
  Star: () => null,
  Trash2: () => null,
}));

describe("Home accessibility", () => {
  it("labels slug input, live status, validation error, and hidden row actions", async () => {
    render(<MemoryRouter><Home /></MemoryRouter>);

    const input = screen.getByLabelText("home.placeholder");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(input.getAttribute("aria-describedby")).toContain(status.id);

    fireEvent.change(input, { target: { value: "invalid slug" } });
    fireEvent.click(screen.getByRole("button", { name: /home.btn.open/ }));

    const alert = await screen.findByRole("alert");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);

    expect(screen.getByRole("button", { name: "home.pinned.unpin" })).toHaveClass(
      "focus-visible:opacity-100",
      "group-focus-within:opacity-100",
    );
    expect(screen.getByRole("button", { name: "home.recent.remove" })).toHaveClass(
      "focus-visible:opacity-100",
      "group-focus-within:opacity-100",
    );
  });
});
