import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectKnowledgeSearchDocs,
  parseKnowledgeQuery,
  rankKnowledgeSearch,
  type KnowledgeSearchDoc,
} from "../knowledge-search";
import {
  getNoteIndexSnapshot,
  hydrateNoteIndex,
  isNoteIndexHydrated,
  resetNoteIndexForTests,
  upsertPlaintextNote,
  whenNoteIndexIdle,
} from "../note-index";
import { touchRecent } from "../recent-notes";

function doc(partial: Partial<KnowledgeSearchDoc> & { slug: string }): KnowledgeSearchDoc {
  return {
    headings: [],
    tags: [],
    pinned: false,
    recent: false,
    recentAt: 0,
    ...partial,
  };
}

describe("parseKnowledgeQuery", () => {
  it("treats ordinary text as a plain search", () => {
    expect(parseKnowledgeQuery("  Họp team  ")).toEqual({
      raw: "  Họp team  ",
      text: "họp team",
      tag: null,
    });
  });

  it("parses a leading #tag filter and leftover text", () => {
    expect(parseKnowledgeQuery("#work")).toEqual({
      raw: "#work",
      text: "",
      tag: "work",
    });
    expect(parseKnowledgeQuery("#Work recipes")).toEqual({
      raw: "#Work recipes",
      text: "recipes",
      tag: "work",
    });
  });

  it("treats a lone # as an incomplete tag filter, not plain text", () => {
    expect(parseKnowledgeQuery("#")).toEqual({
      raw: "#",
      text: "",
      tag: "",
    });
    expect(parseKnowledgeQuery("  #  ")).toEqual({
      raw: "  #  ",
      text: "",
      tag: "",
    });
  });

  it("does not treat tag:foo or a mid-query hash as the filter syntax", () => {
    expect(parseKnowledgeQuery("tag:foo")).toEqual({
      raw: "tag:foo",
      text: "tag:foo",
      tag: null,
    });
    expect(parseKnowledgeQuery("see #work")).toEqual({
      raw: "see #work",
      text: "see #work",
      tag: null,
    });
  });
});

describe("rankKnowledgeSearch", () => {
  const corpus: KnowledgeSearchDoc[] = [
    doc({
      slug: "pinned-note",
      title: "Pinned needle",
      snippet: "only in the pin body",
      pinned: true,
    }),
    doc({
      slug: "recent-note",
      title: "Recent",
      snippet: "needle lives in the recent body",
      recent: true,
      recentAt: 200,
    }),
    doc({
      slug: "title-hit",
      title: "Needle in the title",
      snippet: "unrelated body",
    }),
    doc({
      slug: "heading-hit",
      headings: ["Needle heading"],
      snippet: "unrelated body",
    }),
    doc({
      slug: "body-hit",
      title: "Other",
      snippet: "a needle in the haystack",
    }),
    doc({
      slug: "tagged",
      title: "Tagged",
      tags: ["work"],
      snippet: "no match here",
    }),
  ];

  it("ranks pins, then recents, then title/heading hits, then body", () => {
    const slugs = rankKnowledgeSearch(parseKnowledgeQuery("needle"), corpus).map((hit) => hit.slug);
    expect(slugs).toEqual(["pinned-note", "recent-note", "title-hit", "heading-hit", "body-hit"]);
  });

  it("filters to notes whose indexed plaintext contains that #tag", () => {
    const tagged = rankKnowledgeSearch(parseKnowledgeQuery("#work"), [
      ...corpus,
      doc({ slug: "preview-tagged", preview: "hello #work today", recent: true, recentAt: 1 }),
      doc({ slug: "homework", title: "Homework", snippet: "homework without a tag" }),
    ]);
    expect(tagged.map((hit) => hit.slug).sort()).toEqual(["preview-tagged", "tagged"]);
  });

  it("ANDs leftover text after a #tag", () => {
    const hits = rankKnowledgeSearch(parseKnowledgeQuery("#work needle"), [
      doc({ slug: "both", tags: ["work"], title: "Needle" }),
      doc({ slug: "tag-only", tags: ["work"], title: "Other" }),
      doc({ slug: "text-only", title: "Needle" }),
    ]);
    expect(hits.map((hit) => hit.slug)).toEqual(["both"]);
  });

  it("matches slug, title, heading, and preview/snippet", () => {
    const docs = [
      doc({ slug: "meeting-notes", title: "Ignore" }),
      doc({ slug: "a", title: "Họp team" }),
      doc({ slug: "b", headings: ["Agenda"] }),
      doc({ slug: "c", preview: "unique-preview-token" }),
    ];
    expect(rankKnowledgeSearch(parseKnowledgeQuery("meeting"), docs).map((h) => h.slug)).toEqual([
      "meeting-notes",
    ]);
    expect(rankKnowledgeSearch(parseKnowledgeQuery("họp"), docs).map((h) => h.slug)).toEqual(["a"]);
    expect(rankKnowledgeSearch(parseKnowledgeQuery("agenda"), docs).map((h) => h.slug)).toEqual(["b"]);
    expect(rankKnowledgeSearch(parseKnowledgeQuery("unique-preview"), docs).map((h) => h.slug)).toEqual([
      "c",
    ]);
  });

  it("returns nothing while a tag name is still incomplete", () => {
    expect(rankKnowledgeSearch(parseKnowledgeQuery("#"), corpus)).toEqual([]);
  });
});

describe("knowledge search corpus privacy", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetNoteIndexForTests();
  });

  afterEach(async () => {
    await resetNoteIndexForTests();
    localStorage.clear();
  });

  it("searches encrypted-session rows only while they stay in memory", async () => {
    upsertPlaintextNote(
      "secret",
      "# Secret\nfindme-body #vault\n",
      { durable: false },
    );
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("findme-body"),
        collectKnowledgeSearchDocs(),
      ).map((hit) => hit.slug),
    ).toEqual(["secret"]);
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("#vault"),
        collectKnowledgeSearchDocs(),
      ).map((hit) => hit.slug),
    ).toEqual(["secret"]);

    await whenNoteIndexIdle();
    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();

    expect(collectKnowledgeSearchDocs().some((row) => row.slug === "secret")).toBe(false);
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("findme-body"),
        collectKnowledgeSearchDocs(),
      ),
    ).toEqual([]);
  });

  it("uses recents preview for search without copying it into knowledge IDB", async () => {
    touchRecent("from-home", "private preview body unique-token");
    await hydrateNoteIndex();
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("unique-token"),
        collectKnowledgeSearchDocs(),
      ).map((hit) => hit.slug),
    ).toEqual(["from-home"]);
    expect(JSON.stringify(getNoteIndexSnapshot())).not.toContain("unique-token");

    await whenNoteIndexIdle();
    const opened: string[] = [];
    const orig = indexedDB.open.bind(indexedDB);
    const spy = vi.spyOn(indexedDB, "open").mockImplementation((name, version) => {
      opened.push(String(name));
      return orig(name, version);
    });
    collectKnowledgeSearchDocs();
    rankKnowledgeSearch(parseKnowledgeQuery("unique-token"), collectKnowledgeSearchDocs());
    spy.mockRestore();
    expect(opened).toEqual([]);

    localStorage.clear();
    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("unique-token"),
        collectKnowledgeSearchDocs(),
      ),
    ).toEqual([]);
  });

  it("does not persist live-session snippets into knowledge IDB", async () => {
    upsertPlaintextNote(
      "journal",
      "# Journal\nsecret-snippet-token stays off disk\n",
      { durable: true },
    );
    await whenNoteIndexIdle();
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("secret-snippet-token"),
        collectKnowledgeSearchDocs(),
      ).map((hit) => hit.slug),
    ).toEqual(["journal"]);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("snote-knowledge-index", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("open failed"));
    });
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction("notes", "readonly");
      const request = tx.objectStore("notes").getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    expect(JSON.stringify(rows)).not.toContain("secret-snippet-token");

    await resetNoteIndexForTests({ dropDatabase: false });
    await hydrateNoteIndex();
    expect(isNoteIndexHydrated()).toBe(true);
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("journal"),
        collectKnowledgeSearchDocs(),
      ).map((hit) => hit.slug),
    ).toEqual(["journal"]);
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("secret-snippet-token"),
        collectKnowledgeSearchDocs(),
      ),
    ).toEqual([]);
  });

  it("keeps a live session snippet when durable rows hydrate", async () => {
    upsertPlaintextNote("journal", "# Journal\nkeep-live-snippet\n", { durable: true });
    await whenNoteIndexIdle();
    await resetNoteIndexForTests({ dropDatabase: false });
    upsertPlaintextNote("journal", "# Journal\nkeep-live-snippet\n", { durable: false });
    await hydrateNoteIndex();
    expect(
      rankKnowledgeSearch(
        parseKnowledgeQuery("keep-live-snippet"),
        collectKnowledgeSearchDocs(),
      ).map((hit) => hit.slug),
    ).toEqual(["journal"]);
  });
});
