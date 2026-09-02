import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { togglePin, touchRecent } from "@/lib/recent-notes";
import { filterWikiCompletions } from "../note-graph";
import { resetNoteIndexForTests, upsertPlaintextNote } from "../note-index";
import {
  collectWikiCompletionCandidates,
  wikiLinkQueryAt,
} from "../wiki-link-completion";

describe("wikiLinkQueryAt", () => {
  it("captures the slug query after [[ and ignores typing after |", () => {
    expect(wikiLinkQueryAt("see [[mee")).toBe("mee");
    expect(wikiLinkQueryAt("see ![[mee")).toBe("mee");
    expect(wikiLinkQueryAt("see [[hop-team|")).toBeNull();
    expect(wikiLinkQueryAt("see [[hop-team|Họp")).toBeNull();
    expect(wikiLinkQueryAt("see [[closed]] more")).toBeNull();
    expect(wikiLinkQueryAt("no link")).toBeNull();
  });
});

describe("collectWikiCompletionCandidates", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetNoteIndexForTests();
  });

  afterEach(async () => {
    await resetNoteIndexForTests();
    localStorage.clear();
  });

  it("suggests indexed notes beyond recents-only and boosts pins", () => {
    touchRecent("recent-only");
    togglePin("pinned-note");
    upsertPlaintextNote("recipes", "# Recipes\n## Pasta\n");
    const collected = collectWikiCompletionCandidates();
    const slugs = collected.map((candidate) => candidate.slug);
    expect(slugs).toEqual(expect.arrayContaining(["recent-only", "pinned-note", "recipes"]));
    const filtered = filterWikiCompletions("pasta", collected);
    expect(filtered.map((candidate) => candidate.slug)).toEqual(["recipes"]);
    expect(collected.find((candidate) => candidate.slug === "pinned-note")?.boost).toBeGreaterThan(
      collected.find((candidate) => candidate.slug === "recipes")?.boost ?? 0,
    );
  });
});
