/**
 * ThemeToggle — aria-label + i18n smoke test for scene menu items.
 *
 * Verifies that every enabled scene option in the dropdown:
 *  - is a radio menuitem with `value` matching its registry id;
 *  - exposes an `aria-label` mapped from the i18n dict, in both EN and VI,
 *    formatted as "<label> — <desc>" when a desc exists;
 *  - shows the matching visible label text from the i18n dict.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY as LANG_KEY, dict } from "@/i18n";
import { SCENE_REGISTRY } from "@/components/home/scenes/registry";

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
        await act(async () => {
          await user.click(screen.getByRole("button", { name: dict[lang]["theme.aria"] }));
        });

        for (const scene of enabledScenes) {
          const label = dict[lang][scene.labelKey];
          const desc = scene.descKey ? dict[lang][scene.descKey] : "";
          const expectedAria = desc ? `${label} — ${desc}` : label;

          const item = screen.getByRole("menuitemradio", { name: expectedAria });
          expect(item).toHaveAttribute("aria-label", expectedAria);
          // Visible label text is rendered alongside the swatch.
          expect(within(item).getByText(label)).toBeInTheDocument();
        }
      });
    });
  }

  it("'none' option also exposes an aria-label from i18n (EN)", async () => {
    localStorage.setItem(LANG_KEY, "en");
    const user = userEvent.setup();
    renderToggle();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: dict.en["theme.aria"] }));
    });
    const ariaNone = `${dict.en["scene.none.label"]} — ${dict.en["scene.none.desc"]}`;
    expect(screen.getByRole("menuitemradio", { name: ariaNone })).toBeInTheDocument();
  });
});
