import { safeLocalStorageGet } from "@/lib/safe-storage";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCH_FLAGS_KEY, loadSearchFlags, saveSearchFlags } from "./search-flags";

describe("search flags storage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to all-off and round-trips booleans without a query string", () => {
    expect(loadSearchFlags()).toEqual({
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });
    saveSearchFlags({ caseSensitive: true, regexp: true, wholeWord: false });
    expect(loadSearchFlags()).toEqual({
      caseSensitive: true,
      regexp: true,
      wholeWord: false,
    });
    expect(safeLocalStorageGet(SEARCH_FLAGS_KEY)).not.toMatch(/search/);
  });

  it("ignores corrupt JSON", () => {
    localStorage.setItem(SEARCH_FLAGS_KEY, "{not-json");
    expect(loadSearchFlags()).toEqual({
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });
  });
});
