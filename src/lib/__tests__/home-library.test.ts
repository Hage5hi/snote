import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteCollection,
  filterByIndexTags,
  filterPinnedByIndexTags,
  getCollections,
  indexTagsBySlug,
  noteMatchesTagFilter,
  parseHomeTagFilter,
  upsertCollection,
} from "../home-library";
import { parseTagQuery } from "../tags";
import {
  getNoteIndexSnapshot,
  hydrateNoteIndex,
  rememberMetadata,
  resetNoteIndexForTests,
  upsertPlaintextNote,
} from "../note-index";
import { touchRecent } from "../recent-notes";

describe("parseTagQuery", () => {
  it("reuses extractTags so #Work and work both normalize to work", () => {
    expect(parseTagQuery("#Work")).toEqual(["work"]);
    expect(parseTagQuery("work")).toEqual(["work"]);
    expect(parseTagQuery("#Work #Meeting")).toEqual(["meeting", "work"]);
  });

  it("does not treat a lone # as a tag", () => {
    expect(parseTagQuery("#")).toEqual([]);
    expect(parseTagQuery("")).toEqual([]);
  });
});

describe("parseHomeTagFilter / noteMatchesTagFilter", () => {
  it("treats blank input as inactive (show all)", () => {
    expect(parseHomeTagFilter("  ")).toEqual({ active: false, tags: [] });
    expect(noteMatchesTagFilter(undefined, parseHomeTagFilter(""))).toBe(true);
    expect(noteMatchesTagFilter([], parseHomeTagFilter("   "))).toBe(true);
  });

  it("ANDs multiple tags against index tags only", () => {
    const filter = parseHomeTagFilter("#work #meeting");
    expect(filter).toEqual({ active: true, tags: ["meeting", "work"] });
    expect(noteMatchesTagFilter(["meeting", "work"], filter)).toBe(true);
    expect(noteMatchesTagFilter(["work"], filter)).toBe(false);
  });

  it("fails closed for missing, empty, or unknown tags", () => {
    const filter = parseHomeTagFilter("#work");
    expect(noteMatchesTagFilter(undefined, filter)).toBe(false);
    expect(noteMatchesTagFilter([], filter)).toBe(false);
    expect(noteMatchesTagFilter(["other"], filter)).toBe(false);
  });

  it("fails closed while a tag name is still incomplete", () => {
    const filter = parseHomeTagFilter("#");
    expect(filter.active).toBe(true);
    expect(filter.tags).toEqual([]);
    expect(noteMatchesTagFilter(["work"], filter)).toBe(false);
  });
});

describe("index tag filtering of recents/pins", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetNoteIndexForTests();
  });

  afterEach(async () => {
    await resetNoteIndexForTests();
    localStorage.clear();
  });

  it("filters recents by NoteIndexEntry.tags, not recents preview or body", async () => {
    touchRecent("tagged", "preview should not count #work");
    touchRecent("plain", "also has #work in preview");
    upsertPlaintextNote("tagged", "real body #work");
    rememberMetadata("plain");
    await hydrateNoteIndex();

    const filter = parseHomeTagFilter("#work");
    const tagsBySlug = indexTagsBySlug(getNoteIndexSnapshot());
    expect(tagsBySlug.get("tagged")).toEqual(["work"]);
    expect(tagsBySlug.get("plain") ?? []).toEqual([]);

    const recents = [
      { slug: "tagged" },
      { slug: "plain" },
    ];
    expect(filterByIndexTags(recents, tagsBySlug, filter).map((row) => row.slug)).toEqual([
      "tagged",
    ]);
    expect(JSON.stringify(getNoteIndexSnapshot().find((row) => row.slug === "plain"))).not.toContain("work");
  });

  it("fails closed for encrypted/unknown notes that only have metadata rows", async () => {
    touchRecent("secret");
    rememberMetadata("secret");
    upsertPlaintextNote("open", "#vault in an unlocked note");
    await hydrateNoteIndex();

    const filter = parseHomeTagFilter("#vault");
    const tagsBySlug = indexTagsBySlug(getNoteIndexSnapshot());
    expect(filterPinnedByIndexTags(["secret", "open"], tagsBySlug, filter)).toEqual(["open"]);
  });
});

describe("virtual collections persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates, renames, and deletes collections in localStorage only", () => {
    const created = upsertCollection({ name: " Work ", tags: ["work", "meeting"] });
    expect(created).toMatchObject({ name: "Work", tags: ["meeting", "work"] });
    expect(getCollections()).toEqual([created]);
    expect(JSON.parse(localStorage.getItem("note.collections") ?? "[]")).toEqual([created]);

    const renamed = upsertCollection({ id: created!.id, name: "Office", tags: ["work"] });
    expect(renamed).toMatchObject({ id: created!.id, name: "Office", tags: ["work"] });
    expect(getCollections()[0].name).toBe("Office");

    expect(deleteCollection(created!.id)).toEqual([]);
    expect(getCollections()).toEqual([]);
  });

  it("rejects empty names or empty tag queries and never stores bodies", () => {
    expect(upsertCollection({ name: "  ", tags: ["work"] })).toBeNull();
    expect(upsertCollection({ name: "Work", tags: [] })).toBeNull();
    upsertCollection({ name: "Work", tags: ["work"] });
    expect(JSON.stringify(localStorage.getItem("note.collections"))).not.toContain("ciphertext");
    expect(Object.keys(getCollections()[0]).sort()).toEqual(["id", "name", "tags"]);
  });
});
