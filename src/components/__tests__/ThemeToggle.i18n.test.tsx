/**
 * ThemeToggle — color-scheme-only menu after the Scene picker was split out.
 * Verifies the 3 color entries (Light/Dark/System) render with proper labels
 * and no scene rows appear here anymore.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY as LANG_KEY, dict } from "@/i18n";

function renderToggle() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <I18nProvider>
        <ThemeToggle />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("ThemeToggle — color-only menu", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => cleanup());

  for (const lang of ["en", "vi"] as const) {
    it(`renders 3 color entries in ${lang}`, async () => {
      localStorage.setItem(LANG_KEY, lang);
      const user = userEvent.setup();
      renderToggle();
      await user.click(screen.getByRole("button", { name: dict[lang]["theme.aria"] }));
      for (const key of ["theme.color.light", "theme.color.dark", "theme.color.system"] as const) {
        const item = screen.getByRole("menuitemradio", { name: dict[lang][key] });
        expect(item).toHaveAttribute("aria-label", dict[lang][key]);
        expect(within(item).getByText(dict[lang][key])).toBeInTheDocument();
      }
    });
  }

  it("does NOT render any scene rows in the theme menu", async () => {
    localStorage.setItem(LANG_KEY, "en");
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: dict.en["theme.aria"] }));
    const ariaCyber = `${dict.en["scene.cyber_linh_khi.label"]} — ${dict.en["scene.cyber_linh_khi.desc"]}`;
    expect(screen.queryByRole("menuitemradio", { name: ariaCyber })).toBeNull();
  });
});
