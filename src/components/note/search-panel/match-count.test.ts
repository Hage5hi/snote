import { search, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { countSearchMatches, selectAllSearchMatches } from "./match-count";

function stateWith(doc: string, from: number, to = from) {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
  });
}

describe("countSearchMatches", () => {
  it("returns null when the query is empty", () => {
    expect(countSearchMatches(stateWith("hello", 0), new SearchQuery({ search: "" }))).toBeNull();
  });

  it("returns null for an invalid regexp", () => {
    expect(
      countSearchMatches(stateWith("hello", 0), new SearchQuery({ search: "(", regexp: true })),
    ).toBeNull();
  });

  it("counts matches and the current 1-based index", () => {
    expect(
      countSearchMatches(stateWith("hello hello", 0, 5), new SearchQuery({ search: "hello" })),
    ).toEqual({ current: 1, total: 2 });
    expect(
      countSearchMatches(stateWith("hello hello", 6, 11), new SearchQuery({ search: "hello" })),
    ).toEqual({ current: 2, total: 2 });
  });

  it("reports the next match after the caret when not on a match, wrapping", () => {
    expect(
      countSearchMatches(stateWith("hello hello", 5), new SearchQuery({ search: "hello" })),
    ).toEqual({ current: 2, total: 2 });
    expect(
      countSearchMatches(stateWith("xx hello hello", 0), new SearchQuery({ search: "hello" })),
    ).toEqual({ current: 1, total: 2 });
    expect(
      countSearchMatches(stateWith("hello hello xx", 14), new SearchQuery({ search: "hello" })),
    ).toEqual({ current: 1, total: 2 });
  });

  it("honors match-case and whole-word flags", () => {
    const mixed = stateWith("Hello hello", 0);
    expect(
      countSearchMatches(mixed, new SearchQuery({ search: "hello", caseSensitive: true })),
    ).toEqual({ current: 1, total: 1 });
    expect(
      countSearchMatches(stateWith("hellohead hello", 10), new SearchQuery({ search: "hello", wholeWord: true })),
    ).toEqual({ current: 1, total: 1 });
  });
});

describe("selectAllSearchMatches", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("selects every match of the current query", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      doc: "alpha beta alpha",
      extensions: [search(), EditorState.allowMultipleSelections.of(true)],
      parent,
    });
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "alpha" })) });
    expect(selectAllSearchMatches(view)).toBe(true);
    expect(view.state.selection.ranges.map((range) => [range.from, range.to])).toEqual([
      [0, 5],
      [11, 16],
    ]);
    parent.remove();
  });
});
