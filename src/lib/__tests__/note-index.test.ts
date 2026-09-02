import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { touchRecent } from "@/lib/recent-notes";
import {
  getBacklinks,
  getKnownSlugs,
  hydrateNoteIndex,
  listDeadOutgoing,
  noteIsOrphan,
  rememberMetadata,
  resetNoteIndexForTests,
  upsertPlaintextNote,
  whenNoteIndexIdle,
} from "../note-index";

describe("note-index", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetNoteIndexForTests();
  });

  afterEach(async () => {
    await resetNoteIndexForTests();
    localStorage.clear();
  });

  it("builds backlinks from plaintext already on the client", () => {
    upsertPlaintextNote("journal", "# Journal\nSee [[recipes]]");
    upsertPlaintextNote("recipes", "# Recipes\n");
    expect(getBacklinks("recipes").map((entry) => entry.slug)).toEqual(["journal"]);
    expect(getBacklinks("journal")).toEqual([]);
  });

  it("does not overwrite a stored plaintext graph with an empty first paint", async () => {
    upsertPlaintextNote("recipes", "# Recipes\nSee [[pantry]]");
    await whenNoteIndexIdle();
    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();
    upsertPlaintextNote("recipes", "");
    expect(getBacklinks("pantry").map((entry) => entry.slug)).toEqual(["recipes"]);
  });

  it("soft-flags dead outgoing links against the local known set", () => {
    rememberMetadata("home");
    upsertPlaintextNote("home", "See [[ghost]] and [[home]]");
    expect(listDeadOutgoing("home")).toEqual(["ghost"]);
    expect(noteIsOrphan("home")).toBe(false);
  });

  it("hydrates recents metadata without treating them as a server graph", async () => {
    touchRecent("from-home", "preview text");
    await hydrateNoteIndex();
    expect(getKnownSlugs().has("from-home")).toBe(true);
  });

  it("reloads plaintext graphs from IndexedDB", async () => {
    upsertPlaintextNote("journal", "See [[recipes]]");
    await whenNoteIndexIdle();
    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();
    expect(getBacklinks("recipes").map((entry) => entry.slug)).toEqual(["journal"]);
  });
});
