import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGS } from "@/i18n";
import { dict } from "@/i18n/catalog";

const SRC = resolve(__dirname, "./SearchPanel.tsx");

function extractSearchKeys(): string[] {
  const src = readFileSync(SRC, "utf8");
  const re = /["'](editor\.search\.[a-z0-9_]+)["']/g;
  const set = new Set<string>();
  for (const match of src.matchAll(re)) set.add(match[1]);
  return [...set].sort();
}

describe("search panel i18n keys", () => {
  const keys = extractSearchKeys();

  it("references the required editor.search keys", () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        "editor.search.find",
        "editor.search.replace",
        "editor.search.replace_all",
        "editor.search.next",
        "editor.search.previous",
        "editor.search.close",
        "editor.search.open_replace",
        "editor.search.close_replace",
        "editor.search.settings",
        "editor.search.match_case",
        "editor.search.regexp",
        "editor.search.by_word",
        "editor.search.wrap",
        "editor.search.select_all",
        "editor.search.match_count",
        "editor.search.no_results",
      ]),
    );
  });

  for (const lang of SUPPORTED_LANGS) {
    it(`locale "${lang}" defines every editor.search.* key used by the panel`, () => {
      const table = dict[lang] as Record<string, string>;
      const missing: string[] = [];
      const empty: string[] = [];
      for (const key of keys) {
        if (!(key in table)) missing.push(key);
        else if (typeof table[key] !== "string" || table[key].trim() === "") empty.push(key);
      }
      expect({ lang, missing, empty }).toEqual({ lang, missing: [], empty: [] });
    });
  }
});
