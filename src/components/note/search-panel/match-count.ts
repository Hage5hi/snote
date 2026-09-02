import { getSearchQuery, type SearchQuery } from "@codemirror/search";
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type SearchMatchCount = {
  current: number;
  total: number;
};

function eachMatch(state: EditorState, query: SearchQuery, onMatch: (from: number, to: number) => boolean | void) {
  const cursor = query.getCursor(state);
  let step = cursor.next();
  while (!step.done) {
    if (onMatch(step.value.from, step.value.to) === false) return;
    step = cursor.next();
  }
}

/** 1-based index of the match that contains the main selection, or 0. */
export function countSearchMatches(
  state: EditorState,
  query: SearchQuery,
): SearchMatchCount | null {
  if (!query.valid) return null;
  const sel = state.selection.main;
  let total = 0;
  let current = 0;
  eachMatch(state, query, (from, to) => {
    total++;
    if (sel.empty) {
      if (from <= sel.head && sel.head < to) current = total;
    } else if (from <= sel.from && to >= sel.to) {
      current = total;
    }
  });
  return { current, total };
}

const SELECT_ALL_CAP = 1000;

/** Select every match of the current query. Copies range numbers so a reused cursor value is safe. */
export function selectAllSearchMatches(view: EditorView): boolean {
  const query = getSearchQuery(view.state);
  if (!query.valid) return false;
  const ranges: { from: number; to: number }[] = [];
  eachMatch(view.state, query, (from, to) => {
    ranges.push({ from, to });
    return ranges.length < SELECT_ALL_CAP;
  });
  if (ranges.length === 0 || ranges.length >= SELECT_ALL_CAP) return false;
  view.dispatch({
    selection: EditorSelection.create(ranges.map((range) => EditorSelection.range(range.from, range.to))),
    userEvent: "select.search.matches",
  });
  return true;
}
