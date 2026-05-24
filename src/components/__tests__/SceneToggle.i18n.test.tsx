/**
 * SceneToggle — aria-label + i18n smoke test for scene menu items.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SceneToggle } from "@/components/SceneToggle";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY as LANG_KEY, dict } from "@/i18n";
import { SCENE_REGISTRY } from "@/components/home/scenes/registry";
import { SCENE_STORAGE_KEY } from "@/hooks/use-scene-theme";

function renderToggle() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <I18nProvider>
        <SceneToggle />
      </I18nProvider>
    </MemoryRouter>,
  );
}

const enabledScenes = SCENE_REGISTRY.filter((s) => s.enabled && s.id !== "none");

describe("SceneToggle — scene menuitem aria-label + i18n", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  for (const lang of ["en", "vi"] as const) {
    it(`renders every enabled scene with i18n label + aria-label (${lang})`, async () => {
      localStorage.setItem(LANG_KEY, lang);
      const user = userEvent.setup();
      renderToggle();
      await user.click(screen.getByRole("button", { name: dict[lang]["scene.toggle.aria"] }));

      for (const scene of enabledScenes) {
        const label = dict[lang][scene.labelKey];
        const desc = scene.descKey ? dict[lang][scene.descKey] : "";
        const expectedAria = desc ? `${label} — ${desc}` : label;
        const item = screen.getByRole("menuitemradio", { name: expectedAria });
        expect(item).toHaveAttribute("aria-label", expectedAria);
        expect(within(item).getByText(label)).toBeInTheDocument();
      }
    });
  }

  it("persists the selected scene when Cyber Linh Khí is clicked", async () => {
    localStorage.setItem(LANG_KEY, "en");
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: dict.en["scene.toggle.aria"] }));
    const ariaCyber = `${dict.en["scene.cyber_linh_khi.label"]} — ${dict.en["scene.cyber_linh_khi.desc"]}`;
    await user.click(screen.getByRole("menuitemradio", { name: ariaCyber }));
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe("cyber-linh-khi");
  });

  it("renders the 'none' entry as the first option", async () => {
    localStorage.setItem(LANG_KEY, "en");
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: dict.en["scene.toggle.aria"] }));
    const ariaNone = `${dict.en["scene.none.label"]} — ${dict.en["scene.none.desc"]}`;
    expect(screen.getByRole("menuitemradio", { name: ariaNone })).toBeInTheDocument();
  });
});
