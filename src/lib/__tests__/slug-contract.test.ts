import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RESERVED_SLUGS,
  SLUG_RE,
  isReservedSlug,
  isUsableSlug,
} from "../slug";

const appTsx = readFileSync("src/App.tsx", "utf8");

// Single-segment static routes ("/privacy", "/s", but not "/", "/s/:token",
// "/:slug", "*") plus the literals SlugDispatcher steals from note slugs
// (currently `note` → admin panel). These are exactly the names a note slug
// must never take.
const staticRouteSlugs = [
  ...appTsx.matchAll(/<Route\s+path="\/([^":*][^"]*)"/g),
]
  .map((match) => match[1])
  .filter((path) => !path.includes("/"));
const dispatcherReserved = [...appTsx.matchAll(/slug === "([^"]+)"/g)].map(
  (match) => match[1],
);
const routerReserved = new Set([...staticRouteSlugs, ...dispatcherReserved]);

// Files that previously owned a private slug regex; each must now use the
// shared validator so reserved-name rejection cannot drift between sites.
const sharedValidatorSites = [
  "src/pages/Home.tsx",
  "src/components/CommandPaletteBody.tsx",
  "src/lib/capability/url.ts",
  "src/lib/capability/client.ts",
  "src/lib/legacy/cutover.ts",
  "src/pages/LegacyNotePage.tsx",
  "supabase/functions/note-session/index.ts",
  "supabase/functions/note-manage/index.ts",
];

describe("slug contract", () => {
  it("reserves exactly the router-reserved single-segment names", () => {
    expect([...routerReserved].sort()).toEqual([...RESERVED_SLUGS].sort());
  });

  it("rejects every reserved slug while accepting ordinary slugs", () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(isReservedSlug(reserved)).toBe(true);
      expect(isUsableSlug(reserved)).toBe(false);
    }

    const usable = [
      "my-note",
      "notes",
      "s0",
      "privacy-policy",
      "A1-b_2",
      "a".repeat(64),
    ];
    for (const slug of usable) {
      expect(isUsableSlug(slug)).toBe(true);
    }
  });

  it("keeps reserved-name rejection case-sensitive like the router", () => {
    // React Router matches "/note" case-sensitively, so "Note" still reaches
    // NotePage. If the router ever becomes case-insensitive, these entries
    // must move into RESERVED_SLUGS.
    for (const slug of ["Note", "PRIVACY", "S"]) {
      expect(isUsableSlug(slug)).toBe(true);
    }
  });

  it("keeps rejecting invalid charset, length, and dispatcher syntax", () => {
    for (const slug of [
      "",
      "a b",
      "a/b",
      "doc.md",
      "a+b",
      "a".repeat(65),
      "slüg",
    ]) {
      expect(SLUG_RE.test(slug)).toBe(false);
      expect(isUsableSlug(slug)).toBe(false);
    }
  });

  it("routes every slug validator through the shared module", () => {
    for (const path of sharedValidatorSites) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} must not redefine a private slug regex`).not
        .toMatch(/const (NOTE_)?SLUG_RE\s*=/);
      expect(source, `${path} must use the shared validator`).toMatch(
        /isUsableSlug/,
      );
    }
  });

  it("keeps the Edge reserved list identical to the web reserved list", () => {
    const edgeSource = readFileSync(
      "supabase/functions/_shared/slug.ts",
      "utf8",
    );
    const match = edgeSource.match(
      /RESERVED_SLUGS = \[([^\]]*)\] as const/,
    );
    expect(match).not.toBeNull();
    const edgeReserved = match![1]
      .split(",")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    expect(edgeReserved.sort()).toEqual([...RESERVED_SLUGS].sort());
  });
});
