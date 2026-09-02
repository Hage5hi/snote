import { findNext, findPrevious, search, searchPanelOpen } from "@codemirror/search";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { createSearchPanel } from "./createSearchPanel";
import { openReplacePanel, replaceOpenField, toggleFindPanel } from "./replace-open";
import { loadSearchFlags } from "./search-flags";

/** Extra top inset while Find is open so the first line / current match stay clear. */
export const SEARCH_SCROLL_MARGIN_FIND = 52;
/** Taller inset when the replace row is expanded. */
export const SEARCH_SCROLL_MARGIN_REPLACE = 92;

const editorSearchKeymap: readonly KeyBinding[] = [
  {
    key: "Mod-f",
    run: toggleFindPanel,
    scope: "editor search-panel",
    preventDefault: true,
    stopPropagation: true,
  },
  { key: "Mod-h", mac: "Mod-Alt-f", run: openReplacePanel, scope: "editor search-panel" },
  {
    key: "F3",
    run: findNext,
    shift: findPrevious,
    scope: "editor search-panel",
    preventDefault: true,
  },
];

const searchScrollMargins = EditorView.scrollMargins.of((view) => {
  if (!searchPanelOpen(view.state)) return null;
  const replace = view.state.field(replaceOpenField, false) ?? false;
  return { top: replace ? SEARCH_SCROLL_MARGIN_REPLACE : SEARCH_SCROLL_MARGIN_FIND };
});

const searchEditorAttrs = EditorView.editorAttributes.of((view) => {
  if (!searchPanelOpen(view.state)) return {};
  const replace = view.state.field(replaceOpenField, false) ?? false;
  return {
    class: replace ? "snote-search-open snote-search-replace-open" : "snote-search-open",
  };
});

/** Search state + custom overlay panel. Drop in place of `search({ top: true })`. */
export const editorSearch = [
  EditorState.allowMultipleSelections.of(true),
  replaceOpenField,
  search({
    top: true,
    createPanel: createSearchPanel,
    get caseSensitive() {
      return loadSearchFlags().caseSensitive;
    },
    get regexp() {
      return loadSearchFlags().regexp;
    },
    get wholeWord() {
      return loadSearchFlags().wholeWord;
    },
  }),
  searchScrollMargins,
  searchEditorAttrs,
  Prec.high(keymap.of(editorSearchKeymap)),
];
