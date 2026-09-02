import { describe, expect, it } from "vitest";
import {
  MAX_TRANSCLUDE_DEPTH,
  expandTranscludes,
  extractTranscludes,
} from "../wiki-transclude";
import { expandWikiLinks } from "../wiki-link";

function lookup(notes: Record<string, string | null>) {
  return {
    getPlaintext(slug: string): string | null {
      return Object.prototype.hasOwnProperty.call(notes, slug) ? notes[slug] : null;
    },
  };
}

describe("extractTranscludes", () => {
  it("extracts ![[slug]] and ![[slug|display]] with destination-first alias order", () => {
    const hits = extractTranscludes("see ![[alpha]] and ![[beta|Display]]");
    expect(hits).toEqual([
      { slug: "alpha", display: "alpha", aliased: false, raw: "![[alpha]]" },
      { slug: "beta", display: "Display", aliased: true, raw: "![[beta|Display]]" },
    ]);
  });

  it("skips fenced and inline code", () => {
    const hits = extractTranscludes("![[keep]] `![[no]]`\n```\n![[nope]]\n```\n![[also]]");
    expect(hits.map((hit) => hit.slug)).toEqual(["keep", "also"]);
  });
});

describe("expandTranscludes", () => {
  it("inlines unlocked local plaintext", () => {
    const out = expandTranscludes("Intro\n\n![[recipes]]\n", lookup({
      recipes: "# Pasta\nGarlic.",
    }));
    expect(out).toContain("# Pasta");
    expect(out).toContain("Garlic.");
    expect(out).not.toContain("![[recipes]]");
  });

  it("does not turn a transclude into a markdown image via wiki expansion", () => {
    expect(expandWikiLinks("![[recipes]]")).toBe("![[recipes]]");
    const dead = expandTranscludes("![[ghost]]", lookup({}));
    expect(dead).not.toMatch(/^!\[[^\]]+\]\(/);
    expect(expandWikiLinks(dead)).toBe("[ghost](/ghost)");
  });

  it("renders missing and encrypted-unknown targets as dead wiki links, not a crash", () => {
    const missing = expandTranscludes("![[ghost]]", lookup({}));
    const encrypted = expandTranscludes("![[secret]]", lookup({ secret: null }));
    const aliased = expandTranscludes("![[ghost|Label]]", lookup({}));
    expect(expandWikiLinks(missing)).toBe("[ghost](/ghost)");
    expect(expandWikiLinks(encrypted)).toBe("[secret](/secret)");
    expect(expandWikiLinks(aliased)).toBe("[Label](/ghost)");
  });

  it("skips transcludes inside fenced and inline code", () => {
    const src = "use `![[x]]` please\n```\n![[y]]\n```\n";
    expect(expandTranscludes(src, lookup({ x: "X", y: "Y" }))).toBe(src);
  });

  it("does not fetch or inline notes the lookup refuses (privacy skip)", () => {
    const calls: string[] = [];
    const out = expandTranscludes("![[locked]]", {
      getPlaintext(slug) {
        calls.push(slug);
        return null;
      },
    });
    expect(calls).toEqual(["locked"]);
    expect(out).not.toContain("should-not-leak");
    expect(expandWikiLinks(out)).toBe("[locked](/locked)");
  });

  it("bounds nested transclude recursion and breaks cycles", () => {
    const notes = {
      a: "A ![[b]]",
      b: "B ![[c]]",
      c: "C ![[d]]",
      d: "D",
      loop: "L ![[loop]]",
    };
    const nested = expandTranscludes("![[a]]", lookup(notes), { currentSlug: "host" });
    expect(nested).toContain("A ");
    expect(nested).toContain("B ");
    if (MAX_TRANSCLUDE_DEPTH <= 2) {
      expect(nested).not.toContain("D");
    }
    expect(nested).not.toMatch(/!\[\[/);
    const cycled = expandTranscludes("start ![[loop]]", lookup(notes), { currentSlug: "host" });
    expect(cycled).toContain("L ");
    expect(cycled.match(/L /g)?.length).toBe(1);
    const self = expandTranscludes("hello ![[host]]", lookup({ host: "WHOLE NOTE ![[host]]" }), {
      currentSlug: "host",
    });
    expect(self).not.toContain("WHOLE NOTE");
    expect(expandWikiLinks(self)).toContain("[host](/host)");
  });

  it("leaves [[slug]] wiki links for expandWikiLinks", () => {
    const out = expandTranscludes("see [[alpha]] and ![[beta]]", lookup({ beta: "Beta body" }));
    expect(out).toContain("[[alpha]]");
    expect(out).toContain("Beta body");
    expect(expandWikiLinks(out)).toContain("[alpha](/alpha)");
  });
});
