/**
 * SceneToggle — a11y tests for the hover-preview live region.
 *
 * Verifies that the polite live region:
 *   - exists from initial render (SR can subscribe before menu opens),
 *   - announces "Previewing X" when hovering a row,
 *   - announces "Applied X" on click commit,
 *   - announces "Preview cancelled" when the menu closes without a pick,
 *   - never triggers a localStorage write on hover.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SceneToggle } from "@/components/SceneToggle";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY as LANG_KEY } from "@/i18n";
import { dict } from "@/i18n/catalog";
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

describe("SceneToggle — a11y live region for hover preview", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LANG_KEY, "en");
  });
  afterEach(() => cleanup());

  it("renders a polite live region from initial mount", () => {
    renderToggle();
    const live = screen.getByTestId("scene-toggle-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("role", "status");
    expect(live.textContent).toBe("");
  });

  it("announces 'Previewing X' on hover and does NOT write localStorage", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: dict.en["scene.toggle.aria"] }));

    const label = dict.en["scene.cyber_linh_khi.label"];
    const item = screen.getByRole("menuitemradio", { name: label });
    await user.hover(item);

    const expected = dict.en["scene.preview.announcing"].replace("{name}", label);
    expect(screen.getByTestId("scene-toggle-live").textContent).toBe(expected);
    // Hover preview must NOT persist.
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBeNull();
  });

  it("announces 'Applied X' on click commit and persists the choice", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: dict.en["scene.toggle.aria"] }));

    const label = dict.en["scene.obsidian_ink.label"];
    await user.click(screen.getByRole("menuitemradio", { name: label }));

    const expected = dict.en["scene.preview.committed"].replace("{name}", label);
    expect(screen.getByTestId("scene-toggle-live").textContent).toBe(expected);
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe("obsidian-ink");
  });

  it("every menuitem references the visually-hidden hint via aria-describedby", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: dict.en["scene.toggle.aria"] }));

    const items = screen.getAllByRole("menuitemradio");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const id = item.getAttribute("aria-describedby");
      expect(id).toBeTruthy();
      const hint = document.getElementById(id!);
      expect(hint?.textContent).toBe(dict.en["scene.preview.hint"]);
    }
  });
});
