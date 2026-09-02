import { search } from "@codemirror/search";
import { EditorState, Prec } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";
import { createSearchPanel } from "./createSearchPanel";
import { openReplacePanel, replaceOpenField, toggleFindPanel } from "./replace-open";

const editorSearchKeymap: readonly KeyBinding[] = [
  {
    key: "Mod-f",
    run: toggleFindPanel,
    scope: "editor search-panel",
    preventDefault: true,
    stopPropagation: true,
  },
  { key: "Mod-h", mac: "Mod-Alt-f", run: openReplacePanel, scope: "editor search-panel" },
];

/** Search state + custom overlay panel. Drop in place of `search({ top: true })`. */
export const editorSearch = [
  EditorState.allowMultipleSelections.of(true),
  replaceOpenField,
  search({ top: true, createPanel: createSearchPanel }),
  Prec.high(keymap.of(editorSearchKeymap)),
];
