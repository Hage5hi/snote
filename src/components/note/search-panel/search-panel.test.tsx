import {
  findNext,
  getSearchQuery,
  openSearchPanel,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dict } from "@/i18n/catalog";
import { loadDictionary, STORAGE_KEY } from "@/i18n";
import { editorSearch, openFindPanel, openReplacePanel } from "./index";
import { SEARCH_SCROLL_MARGIN_FIND, SEARCH_SCROLL_MARGIN_REPLACE } from "./extension";
import { SEARCH_FLAGS_KEY } from "./search-flags";

function mountEditor(doc = "alpha beta alpha") {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [editorSearch, keymap.of(searchKeymap)],
    }),
    parent,
  });
  return {
    view,
    parent,
    destroy() {
      view.destroy();
      parent.remove();
    },
  };
}

describe("custom editor search panel", () => {
  let env: ReturnType<typeof mountEditor> | undefined;

  beforeEach(() => {
    localStorage.clear();
    if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
      Range.prototype.getClientRects = function getClientRects() {
        return [] as unknown as DOMRectList;
      };
      Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
        return new DOMRect(0, 0, 0, 0);
      };
    }
  });

  afterEach(() => {
    env?.destroy();
    env = undefined;
    cleanup();
  });

  async function openFind(view: EditorView) {
    openFindPanel(view);
    return waitFor(() => screen.getByTestId("note-search-panel"));
  }

  it("opens a themed find row instead of the default CodeMirror form", async () => {
    env = mountEditor();
    const panel = await openFind(env.view);

    expect(panel.querySelector(".cm-search")).toBeNull();
    expect(panel.querySelector("input[type='checkbox']")).toBeNull();
    expect(panel).toHaveClass("bg-card/95");
    expect(screen.getByTestId("note-search-find")).toHaveAttribute(
      "placeholder",
      dict.en["editor.search.find"],
    );
    expect(screen.getByTestId("note-search-find")).toHaveAttribute("main-field", "true");
    expect(document.activeElement).toBe(screen.getByTestId("note-search-find"));
    expect(panel).toHaveAttribute("data-replace-open", "false");
    expect(env.parent.querySelector("button.cm-button")).toBeNull();
  });

  it("expands replace from the chevron and from openReplacePanel", async () => {
    env = mountEditor();
    const user = userEvent.setup();
    await openFind(env.view);

    const chevron = screen.getByRole("button", { name: dict.en["editor.search.open_replace"] });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    await user.click(chevron);

    expect(screen.getByRole("button", { name: dict.en["editor.search.close_replace"] })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("note-search-panel")).toHaveAttribute("data-replace-open", "true");
    expect(screen.getByTestId("note-search-replace-row")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("note-search-replace")).toBeVisible();

    env.destroy();
    env = mountEditor();
    openReplacePanel(env.view);
    await waitFor(() => {
      expect(screen.getByTestId("note-search-panel")).toHaveAttribute("data-replace-open", "true");
    });
  });

  it("toggles match case, regexp, and whole word from the settings menu", async () => {
    env = mountEditor();
    const user = userEvent.setup();
    await openFind(env.view);
    await user.click(screen.getByRole("button", { name: dict.en["editor.search.settings"] }));

    await user.click(screen.getByRole("menuitemcheckbox", { name: dict.en["editor.search.match_case"] }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: dict.en["editor.search.regexp"] }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: dict.en["editor.search.by_word"] }));

    const query = getSearchQuery(env.view.state);
    expect(query.caseSensitive).toBe(true);
    expect(query.regexp).toBe(true);
    expect(query.wholeWord).toBe(true);

    expect(screen.queryByRole("menuitemcheckbox", { name: dict.en["editor.search.wrap"] })).toBeNull();
  });

  it("selects all matches from the settings menu", async () => {
    env = mountEditor();
    await openFind(env.view);
    fireEvent.input(screen.getByTestId("note-search-find"), { target: { value: "alpha" } });
    await waitFor(() => {
      expect(getSearchQuery(env!.view.state).search).toBe("alpha");
    });
    fireEvent.click(screen.getByRole("button", { name: dict.en["editor.search.settings"] }));
    fireEvent.click(screen.getByRole("menuitem", { name: dict.en["editor.search.select_all"] }));
    expect(env.view.state.selection.ranges.map((range) => [range.from, range.to])).toEqual([
      [0, 5],
      [11, 16],
    ]);
  });

  it("shows a match count while there is a query", async () => {
    env = mountEditor();
    await openFind(env.view);
    fireEvent.input(screen.getByTestId("note-search-find"), { target: { value: "alpha" } });
    await waitFor(() => {
      expect(screen.getByTestId("note-search-count")).toHaveTextContent("1/2");
    });
  });

  it("shows the next match index when the caret is not on a match", async () => {
    env = mountEditor();
    env.view.dispatch({ selection: { anchor: 5 } });
    await openFind(env.view);
    fireEvent.input(screen.getByTestId("note-search-find"), { target: { value: "alpha" } });
    await waitFor(() => {
      expect(screen.getByTestId("note-search-count")).toHaveTextContent("2/2");
    });
  });

  it("renders English and Vietnamese copy", async () => {
    env = mountEditor();
    await openFind(env.view);
    expect(screen.getByPlaceholderText(dict.en["editor.search.find"])).toBeInTheDocument();

    await loadDictionary("vi");
    localStorage.setItem(STORAGE_KEY, "vi");
    window.dispatchEvent(new CustomEvent("i18n:lang-changed", { detail: "vi" }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(dict.vi["editor.search.find"])).toBeInTheDocument();
    });
  });

  it("finds next on Enter and previous on Shift+Enter, and closes on Escape", async () => {
    env = mountEditor();
    await openFind(env.view);
    const find = screen.getByTestId("note-search-find");
    fireEvent.input(find, { target: { value: "alpha" } });
    fireEvent.keyDown(find, { key: "Enter" });
    expect(env.view.state.selection.main.from).toBe(0);
    expect(env.view.state.selection.main.to).toBe(5);

    fireEvent.keyDown(find, { key: "Enter" });
    expect(env.view.state.selection.main.from).toBe(11);

    fireEvent.keyDown(find, { key: "Enter", shiftKey: true });
    expect(env.view.state.selection.main.from).toBe(0);

    fireEvent.keyDown(screen.getByTestId("note-search-panel"), { key: "Escape" });
    await waitFor(() => expect(searchPanelOpen(env!.view.state)).toBe(false));
  });

  it("keeps the default CodeMirror openSearchPanel command working", async () => {
    env = mountEditor();
    openSearchPanel(env.view);
    const panel = await waitFor(() => screen.getByTestId("note-search-panel"));
    expect(within(panel).getByTestId("note-search-find")).toBeTruthy();
  });

  it("closes on Ctrl+F / Mod-f while the Find field is focused", async () => {
    env = mountEditor();
    await openFind(env.view);
    const find = screen.getByTestId("note-search-find");
    expect(document.activeElement).toBe(find);

    fireEvent.keyDown(find, { key: "f", ctrlKey: true });
    await waitFor(() => expect(searchPanelOpen(env!.view.state)).toBe(false));
    expect(screen.queryByTestId("note-search-panel")).toBeNull();
  });

  it("closes on Ctrl+F while the Replace field is focused", async () => {
    env = mountEditor();
    openReplacePanel(env.view);
    const replace = await waitFor(() => screen.getByTestId("note-search-replace"));
    replace.focus();
    fireEvent.keyDown(replace, { key: "f", ctrlKey: true });
    await waitFor(() => expect(searchPanelOpen(env!.view.state)).toBe(false));
  });

  it("does not close on Ctrl+H or Cmd+Option+F while the panel is open", async () => {
    env = mountEditor();
    await openFind(env.view);
    const find = screen.getByTestId("note-search-find");

    fireEvent.keyDown(find, { key: "h", ctrlKey: true });
    expect(searchPanelOpen(env.view.state)).toBe(true);
    expect(screen.getByTestId("note-search-panel")).toHaveAttribute("data-replace-open", "true");

    fireEvent.keyDown(find, { key: "f", metaKey: true, altKey: true });
    expect(searchPanelOpen(env.view.state)).toBe(true);
    expect(screen.getByTestId("note-search-panel")).toBeTruthy();
  });

  it("docks the overlay to the top-right instead of a centered 40rem bar", async () => {
    env = mountEditor();
    const panel = await openFind(env.view);
    expect(panel.className).toMatch(/\bml-auto\b/);
    expect(panel.className).not.toMatch(/\bmx-auto\b/);
    expect(panel.className).not.toMatch(/40rem/);
    expect(panel.className).toMatch(/26rem|max-w-full/);
  });

  it("adds a scroll-margin class while the overlay is open and grows it for replace", async () => {
    env = mountEditor();
    await openFind(env.view);
    expect(env.view.dom.className).toMatch(/\bsnote-search-open\b/);
    expect(env.view.dom.className).not.toMatch(/snote-search-replace-open/);

    const findMargins = env.view.state.facet(EditorView.scrollMargins)
      .map((fn) => fn(env!.view))
      .filter((margin): margin is NonNullable<typeof margin> => margin != null);
    expect(findMargins.some((margin) => margin.top === SEARCH_SCROLL_MARGIN_FIND)).toBe(true);

    openReplacePanel(env.view);
    await waitFor(() => {
      expect(env!.view.dom.className).toMatch(/snote-search-replace-open/);
    });
    const replaceMargins = env.view.state.facet(EditorView.scrollMargins)
      .map((fn) => fn(env!.view))
      .filter((margin): margin is NonNullable<typeof margin> => margin != null);
    expect(replaceMargins.some((margin) => margin.top === SEARCH_SCROLL_MARGIN_REPLACE)).toBe(true);
  });

  it("keeps F3 in the editor search keymap and finds the next match after the panel closes", async () => {
    expect(searchKeymap.some((binding) => binding.key === "F3")).toBe(true);
    env = mountEditor();
    await openFind(env.view);
    fireEvent.input(screen.getByTestId("note-search-find"), { target: { value: "alpha" } });
    await waitFor(() => {
      expect(getSearchQuery(env!.view.state).search).toBe("alpha");
    });
    fireEvent.keyDown(screen.getByTestId("note-search-panel"), { key: "Escape" });
    await waitFor(() => expect(searchPanelOpen(env!.view.state)).toBe(false));

    env.view.dispatch({ selection: { anchor: 0 } });
    expect(findNext(env.view)).toBe(true);
    expect(env.view.state.selection.main.from).toBe(0);
    expect(findNext(env.view)).toBe(true);
    expect(env.view.state.selection.main.from).toBe(11);
  });

  it("persists case/regex/whole-word across panel close and a new editor, but not the query", async () => {
    env = mountEditor();
    const user = userEvent.setup();
    await openFind(env.view);
    fireEvent.input(screen.getByTestId("note-search-find"), { target: { value: "alpha" } });
    await user.click(screen.getByRole("button", { name: dict.en["editor.search.settings"] }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: dict.en["editor.search.match_case"] }));
    expect(JSON.parse(localStorage.getItem(SEARCH_FLAGS_KEY) ?? "{}")).toMatchObject({
      caseSensitive: true,
      regexp: false,
      wholeWord: false,
    });

    fireEvent.keyDown(screen.getByTestId("note-search-panel"), { key: "Escape" });
    await waitFor(() => expect(searchPanelOpen(env!.view.state)).toBe(false));

    env.destroy();
    env = mountEditor();
    expect(getSearchQuery(env.view.state).caseSensitive).toBe(true);
    expect(getSearchQuery(env.view.state).search).toBe("");
    await openFind(env.view);
    expect(screen.getByTestId("note-search-find")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: dict.en["editor.search.settings"] }));
    expect(screen.getByRole("menuitemcheckbox", { name: dict.en["editor.search.match_case"] })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
