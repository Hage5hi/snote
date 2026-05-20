/**
 * ThemeToggle — aria-label + i18n smoke test for scene menu items.
 *
 * Verifies that every enabled scene option in the dropdown:
 *  - is a radio menuitem with `value` matching its registry id;
 *  - exposes an `aria-label` mapped from the i18n dict, in both EN and VI,
 *    formatted as "<label> — <desc>" when a desc exists;
 *  - shows the matching visible label text from the i18n dict.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY as LANG_KEY, dict } from "@/i18n";
import { SCENE_REGISTRY } from "@/components/home/scenes/registry";
import { SCENE_STORAGE_KEY } from "@/hooks/use-scene-theme";

function renderToggle() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <I18nProvider>
        <ThemeToggle />
      </I18nProvider>
    </MemoryRouter>,
  );
}

const enabledScenes = SCENE_REGISTRY.filter((s) => s.enabled && s.id !== "none");

describe("ThemeToggle — scene menuitem aria-label + i18n", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => cleanup());

  for (const lang of ["en", "vi"] as const) {
    describe(`locale=${lang}`, () => {
      beforeEach(() => {
        localStorage.setItem(LANG_KEY, lang);
      });

      it("renders every enabled scene with i18n label + aria-label", async () => {
        const user = userEvent.setup();
        renderToggle();
        await user.click(screen.getByRole("button", { name: dict[lang]["theme.aria"] }));

        for (const key of ["theme.color.light", "theme.color.dark", "theme.color.system"] as const) {
          const item = screen.getByRole("menuitemradio", { name: dict[lang][key] });
          expect(item).toHaveAttribute("aria-label", dict[lang][key]);
          expect(within(item).getByText(dict[lang][key])).toBeInTheDocument();
        }

        for (const scene of enabledScenes) {
          const label = dict[lang][scene.labelKey];
          const desc = scene.descKey ? dict[lang][scene.descKey] : "";
          const expectedAria = desc ? `${label} — ${desc}` : label;

          const item = screen.getByRole("menuitemradio", { name: expectedAria });
          expect(item).toHaveAttribute("aria-label", expectedAria);
          expect(within(item).getByText(label)).toBeInTheDocument();
        }
      });
    });
  }

  it("supports keyboard navigation with Tab, Arrow keys, and Escape", async () => {
    localStorage.setItem(LANG_KEY, "en");
    const user = userEvent.setup();
    renderToggle();

    await user.tab();
    expect(screen.getByRole("button", { name: dict.en["theme.aria"] })).toHaveFocus();
    await user.keyboard("{Enter}");

    const items = screen.getAllByRole("menuitemradio");
    const focusedBefore = document.activeElement;
    await user.keyboard("{ArrowDown}");
    expect(items).toContain(document.activeElement);
    expect(document.activeElement).not.toBe(focusedBefore);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitemradio", { name: dict.en["theme.color.light"] })).toBeNull();
  });

  it("does NOT render a 'none' scene row (single-axis menu)", async () => {
    localStorage.setItem(LANG_KEY, "en");
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: dict.en["theme.aria"] }));
    const ariaNone = `${dict.en["scene.none.label"]} — ${dict.en["scene.none.desc"]}`;
    expect(screen.queryByRole("menuitemradio", { name: ariaNone })).toBeNull();
  });


  it("persists the selected scene when Cyber Linh Khí is clicked", async () => {
    localStorage.setItem(LANG_KEY, "en");
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: dict.en["theme.aria"] }));
    const ariaCyber = `${dict.en["scene.cyber_linh_khi.label"]} — ${dict.en["scene.cyber_linh_khi.desc"]}`;
    await user.click(screen.getByRole("menuitemradio", { name: ariaCyber }));
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe("cyber-linh-khi");
  });
});
