import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { touchRecent } from "@/lib/recent-notes";
import {
  getBacklinks,
  getKnownSlugs,
  getNoteIndexSnapshot,
  getSessionPlaintext,
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
    upsertPlaintextNote("recipes", "# Recipes\nSee [[pantry]]", { durable: true });
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

  it("hydrates recents as slug-only metadata, never preview or body", async () => {
    touchRecent("from-home", "private preview body");
    await hydrateNoteIndex();
    expect(getKnownSlugs().has("from-home")).toBe(true);
    const entry = getNoteIndexSnapshot().find((row) => row.slug === "from-home");
    expect(entry?.title).toBeUndefined();
    expect(entry?.outgoingLinks).toEqual([]);
    expect(JSON.stringify(entry)).not.toContain("private preview body");
  });

  it("reloads durable plaintext graphs from IndexedDB", async () => {
    upsertPlaintextNote("journal", "See [[recipes]]", { durable: true });
    await whenNoteIndexIdle();
    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();
    expect(getBacklinks("recipes").map((entry) => entry.slug)).toEqual(["journal"]);
  });

  it("keeps encrypted-session graphs in memory and does not reload them", async () => {
    upsertPlaintextNote("secret", "# Secret\nSee [[recipes]]", { durable: false });
    await whenNoteIndexIdle();
    expect(getBacklinks("recipes").map((entry) => entry.slug)).toEqual(["secret"]);
    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();
    expect(getBacklinks("recipes")).toEqual([]);
    expect(getKnownSlugs().has("secret")).toBe(false);
  });

  it("does not persist recents/pins metadata into knowledge IDB", async () => {
    touchRecent("from-home", "private preview body");
    rememberMetadata("from-home");
    await hydrateNoteIndex();
    await whenNoteIndexIdle();
    localStorage.clear();
    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();
    expect(getKnownSlugs().has("from-home")).toBe(false);
  });

  it("exposes full session plaintext for transclude and never reloads it from IDB", async () => {
    rememberMetadata("from-home");
    expect(getSessionPlaintext("from-home")).toBeNull();
    upsertPlaintextNote("recipes", "# Pasta\nGarlic");
    expect(getSessionPlaintext("recipes")).toBe("# Pasta\nGarlic");
    upsertPlaintextNote("secret", "# Secret body", { durable: false });
    expect(getSessionPlaintext("secret")).toBe("# Secret body");
    await whenNoteIndexIdle();
    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();
    expect(getSessionPlaintext("recipes")).toBeNull();
    expect(getSessionPlaintext("secret")).toBeNull();
    expect(JSON.stringify(getNoteIndexSnapshot())).not.toContain("Secret body");
  });

  it("opens only the knowledge-index database, never note:${slug} Yjs IDB", async () => {
    const opened: string[] = [];
    const orig = indexedDB.open.bind(indexedDB);
    const spy = vi.spyOn(indexedDB, "open").mockImplementation((name, version) => {
      opened.push(String(name));
      return orig(name, version);
    });
    upsertPlaintextNote("journal", "See [[recipes]]", { durable: true });
    await whenNoteIndexIdle();
    await hydrateNoteIndex();
    spy.mockRestore();
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((name) => name === "snote-knowledge-index")).toBe(true);
  });

  it("clears v1 knowledge-index rows so session graphs cannot reload", async () => {
    await resetNoteIndexForTests();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("snote-knowledge-index", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("notes")) {
          db.createObjectStore("notes", { keyPath: "slug" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("notes", "readwrite");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.objectStore("notes").put({
          slug: "secret",
          title: "Should not leak",
          headings: ["Should not leak"],
          outgoingLinks: ["recipes"],
          updatedAt: Date.now(),
          source: "plaintext",
        });
      };
      request.onerror = () => reject(request.error ?? new Error("open failed"));
    });
    await hydrateNoteIndex();
    expect(getKnownSlugs().has("secret")).toBe(false);
    expect(getBacklinks("recipes")).toEqual([]);
  });
});
