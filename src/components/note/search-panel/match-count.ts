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

/**
 * 1-based index of the match that contains the main selection.
 * If the caret is not on a match, reports the next match after the caret
 * (wrapping), so the Find field never shows 0/N while matches exist.
 */
export function countSearchMatches(
  state: EditorState,
  query: SearchQuery,
): SearchMatchCount | null {
  if (!query.valid) return null;
  const sel = state.selection.main;
  const ranges: { from: number; to: number }[] = [];
  eachMatch(state, query, (from, to) => {
    ranges.push({ from, to });
  });
  const total = ranges.length;
  if (total === 0) return { current: 0, total: 0 };

  for (let i = 0; i < ranges.length; i++) {
    const { from, to } = ranges[i];
    const onMatch = sel.empty
      ? from <= sel.head && sel.head < to
      : from <= sel.from && sel.to <= to;
    if (onMatch) return { current: i + 1, total };
  }

  const after = sel.empty ? sel.head : sel.to;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].from >= after) return { current: i + 1, total };
  }
  return { current: 1, total };
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
