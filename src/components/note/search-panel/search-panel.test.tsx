import {
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

    const wrap = screen.getByRole("menuitemcheckbox", { name: dict.en["editor.search.wrap"] });
    expect(wrap).toHaveAttribute("aria-checked", "true");
    expect(wrap).toBeDisabled();
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
});
