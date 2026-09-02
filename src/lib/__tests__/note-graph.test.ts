import { describe, expect, it } from "vitest";
import {
  backlinksTo,
  buildNoteGraphRecord,
  deadOutgoing,
  filterWikiCompletions,
  isOrphanNote,
} from "../note-graph";

describe("buildNoteGraphRecord", () => {
  it("uses the first heading as title and collects unique outgoing wiki slugs", () => {
    const record = buildNoteGraphRecord(
      "home",
      "# Daily notes\n\nSee [[alpha]] and [[beta|Display]] and [[alpha]] again.\n## Setup\n",
    );
    expect(record).toEqual({
      slug: "home",
      title: "Daily notes",
      headings: ["Daily notes", "Setup"],
      outgoingLinks: ["alpha", "beta"],
      tags: [],
    });
  });

  it("skips self-links and wiki tokens inside code", () => {
    const record = buildNoteGraphRecord(
      "home",
      "[[home]] `[[ignored]]`\n```\n[[also-ignored]]\n```\n[[other]]",
    );
    expect(record.outgoingLinks).toEqual(["other"]);
  });
});

describe("backlinksTo", () => {
  it("returns notes whose outgoing links include the target, sorted by title", () => {
    const entries = [
      buildNoteGraphRecord("b", "# Zebra\n[[target]]"),
      buildNoteGraphRecord("a", "# Apple\n[[target]]"),
      buildNoteGraphRecord("c", "# Skip\n[[nope]]"),
      buildNoteGraphRecord("target", "# Self\n[[target]]"),
    ];
    expect(backlinksTo(entries, "target").map((entry) => entry.slug)).toEqual(["a", "b"]);
  });
});

describe("deadOutgoing / isOrphanNote", () => {
  it("treats unknown outgoing slugs as dead once the index has any evidence", () => {
    expect(deadOutgoing(["a", "b"], new Set())).toEqual([]);
    expect(deadOutgoing(["a", "b"], new Set(["a", "here"]))).toEqual(["b"]);
  });

  it("marks a note as an orphan only when nothing links in or out", () => {
    expect(isOrphanNote(0, 0)).toBe(true);
    expect(isOrphanNote(1, 0)).toBe(false);
    expect(isOrphanNote(0, 1)).toBe(false);
  });
});

describe("filterWikiCompletions", () => {
  const candidates = [
    { slug: "meeting-notes", title: "Họp team", headings: ["Agenda"], boost: 1 },
    { slug: "alpha", preview: "recent preview", boost: 2 },
    { slug: "pinned", boost: 3 },
  ];

  it("matches slug, title, heading, or preview and keeps pin/recents boost order", () => {
    expect(filterWikiCompletions("họp", candidates).map((c) => c.slug)).toEqual(["meeting-notes"]);
    expect(filterWikiCompletions("agenda", candidates).map((c) => c.slug)).toEqual(["meeting-notes"]);
    expect(filterWikiCompletions("preview", candidates).map((c) => c.slug)).toEqual(["alpha"]);
    expect(filterWikiCompletions("", candidates).map((c) => c.slug)).toEqual([
      "pinned",
      "alpha",
      "meeting-notes",
    ]);
  });
});
