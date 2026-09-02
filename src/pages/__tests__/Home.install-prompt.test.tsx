import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../Home";
import { dict } from "@/i18n/catalog";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY } from "@/i18n";

const harness = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  abortSignal: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => harness.from(...args),
  },
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/SceneToggle", () => ({ SceneToggle: () => null }));
vi.mock("@/components/LanguageToggle", () => ({ LanguageToggle: () => null }));
vi.mock("@/components/home/SceneHost", () => ({ default: () => null }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-scene-theme", () => ({
  useSceneTheme: () => ({
    scene: "none",
    committedScene: "none",
    setScene: vi.fn(),
  }),
}));

const query = {
  select: harness.select,
  eq: harness.eq,
  abortSignal: harness.abortSignal,
  maybeSingle: harness.maybeSingle,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(STORAGE_KEY, "en");
  localStorage.setItem("lang.ip_detected", "1");
  Object.values(harness).forEach((mock) => mock.mockReset());
  harness.from.mockReturnValue(query);
  harness.select.mockReturnValue(query);
  harness.eq.mockReturnValue(query);
  harness.abortSignal.mockReturnValue(query);
  harness.maybeSingle.mockResolvedValue({ data: null, error: null });
});

afterEach(() => cleanup());

describe("Home install prompt vs lazy template picker", () => {
  it("keeps the install dialog open after the lazy template picker hydrates", async () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </I18nProvider>,
    );

    const trigger = await screen.findByRole("button", {
      name: dict.en["install.title"],
    });
    fireEvent.mouseDown(trigger);

    expect(screen.getByRole("dialog")).toBeVisible();

    expect(await screen.findByLabelText(dict.en["home.templates.aria"])).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeVisible();
    });
    expect(
      screen.queryByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
    ).not.toBeInTheDocument();
  });
});
