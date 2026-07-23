import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SCENE_NONE } from "@/components/home/scenes/registry";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY as LANG_KEY, dict } from "@/i18n";

const themeMocks = vi.hoisted(() => ({
  resolvedTheme: "light",
  setTheme: vi.fn(),
  setScene: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: themeMocks.resolvedTheme,
    setTheme: themeMocks.setTheme,
  }),
}));

vi.mock("@/hooks/use-scene-theme", () => ({
  useSceneTheme: () => ({ setScene: themeMocks.setScene }),
}));

function renderToggle() {
  return render(
    <I18nProvider>
      <ThemeToggle />
    </I18nProvider>,
  );
}

describe("ThemeToggle — direct color-scheme toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    themeMocks.resolvedTheme = "light";
    themeMocks.setTheme.mockReset();
    themeMocks.setScene.mockReset();
  });

  afterEach(() => cleanup());

  for (const lang of ["en", "vi"] as const) {
    it(`uses the localized accessible name in ${lang}`, () => {
      localStorage.setItem(LANG_KEY, lang);
      renderToggle();
      expect(
        screen.getByRole("button", { name: dict[lang]["theme.aria"] }),
      ).toBeInTheDocument();
    });
  }

  it("clears the active scene and switches light to dark", async () => {
    localStorage.setItem(LANG_KEY, "en");
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole("button", { name: dict.en["theme.aria"] }));

    expect(themeMocks.setScene).toHaveBeenCalledWith(SCENE_NONE);
    expect(themeMocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it("switches dark to light", async () => {
    themeMocks.resolvedTheme = "dark";
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole("button", { name: dict.en["theme.aria"] }));

    expect(themeMocks.setTheme).toHaveBeenCalledWith("light");
  });
});
