import { closeSearchPanel, openSearchPanel, searchPanelOpen } from "@codemirror/search";
import { StateEffect, StateField } from "@codemirror/state";
import type { Command } from "@codemirror/view";

export const setReplaceOpen = StateEffect.define<boolean>();

export const replaceOpenField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setReplaceOpen)) return effect.value;
    }
    return value;
  },
});

/** Open find, collapsed, unless the panel is already showing. */
export const openFindPanel: Command = (view) => {
  if (!searchPanelOpen(view.state)) {
    view.dispatch({ effects: setReplaceOpen.of(false) });
  }
  return openSearchPanel(view);
};

/** Open find with the replace row expanded (Ctrl+H / Cmd+Option+F). */
export const openReplacePanel: Command = (view) => {
  view.dispatch({ effects: setReplaceOpen.of(true) });
  return openSearchPanel(view);
};

/** Ctrl/Cmd+F: open when closed, close immediately when already open. */
export const toggleFindPanel: Command = (view) => {
  if (searchPanelOpen(view.state)) return closeSearchPanel(view);
  return openFindPanel(view);
};
