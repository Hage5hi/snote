import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { setSearchQuery } from "@codemirror/search";
import { SearchPanel } from "./SearchPanel";
import { setReplaceOpen } from "./replace-open";

export function createSearchPanel(view: EditorView): Panel {
  const host = document.createElement("div");
  host.className = "snote-search-host";
  const root: Root = createRoot(host);
  let disposed = false;
  let current = view;

  const paint = () => {
    if (disposed) return;
    flushSync(() => {
      root.render(<SearchPanel view={current} />);
    });
  };

  return {
    dom: host,
    top: true,
    mount() {
      paint();
      const input = host.querySelector("[main-field]") as HTMLInputElement | null;
      input?.focus();
      input?.select();
    },
    update(update: ViewUpdate) {
      current = update.view;
      let relevant = update.docChanged || update.selectionSet;
      if (!relevant) {
        for (const tr of update.transactions) {
          for (const effect of tr.effects) {
            if (effect.is(setSearchQuery) || effect.is(setReplaceOpen)) {
              relevant = true;
              break;
            }
          }
          if (relevant) break;
        }
      }
      if (relevant) paint();
    },
    destroy() {
      disposed = true;
      root.unmount();
    },
  };
}
