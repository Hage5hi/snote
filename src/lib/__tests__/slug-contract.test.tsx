import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
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

function RouteProbe({ label }: { label: string }) {
  return <div data-route-probe={label} />;
}

describe("slug contract", () => {
  it("reserves exactly the router-reserved single-segment names", () => {
    expect([...routerReserved].sort()).toEqual([...RESERVED_SLUGS].sort());
  });

  it("dispatches every case variant of a static reserved route away from notes, using the real router", () => {
    // react-router matches static routes case-insensitively by default:
    // /PRIVACY and /S must never fall through to /:slug. The route table
    // here mirrors the static single-segment routes extracted from
    // App.tsx, so adding a reserved route without updating RESERVED_SLUGS
    // fails the sync test above, and loosening router case behavior fails
    // here.
    for (const reserved of staticRouteSlugs) {
      for (const variant of [
        reserved,
        reserved.toUpperCase(),
        reserved[0].toUpperCase() + reserved.slice(1),
      ]) {
        const { container, unmount } = render(
          <MemoryRouter initialEntries={[`/${variant}`]}>
            <Routes>
              <Route path={`/${reserved}`} element={<RouteProbe label={reserved} />} />
              <Route path="/:slug" element={<RouteProbe label="__slug__" />} />
            </Routes>
          </MemoryRouter>,
        );
        expect(
          container.querySelector("[data-route-probe]")?.getAttribute("data-route-probe"),
          `/${variant}`,
        ).toBe(reserved);
        unmount();
      }
    }
  });

  it("rejects every case variant of every reserved slug", () => {
    for (const reserved of RESERVED_SLUGS) {
      for (const variant of [
        reserved,
        reserved.toUpperCase(),
        reserved[0].toUpperCase() + reserved.slice(1),
      ]) {
        expect(isReservedSlug(variant), variant).toBe(true);
        expect(isUsableSlug(variant), variant).toBe(false);
      }
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

  it("keeps the Edge reserved list identical and case-insensitive like the web list", () => {
    const edgeSource = readFileSync(
      "supabase/functions/_shared/slug.ts",
      "utf8",
    );
    const listMatch = edgeSource.match(
      /RESERVED_SLUGS = \[([^\]]*)\] as const/,
    );
    expect(listMatch).not.toBeNull();
    const edgeReserved = listMatch![1]
      .split(",")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    expect(edgeReserved.sort()).toEqual([...RESERVED_SLUGS].sort());
    // The Edge check must lowercase before comparing, same as the web module.
    expect(edgeSource).toMatch(/isReservedSlug[\s\S]*?toLowerCase/);
  });
});
