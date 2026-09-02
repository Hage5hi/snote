import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  WIKI_LINK_RE,
  expandWikiLinks,
  extractWikiLinks,
  parseWikiLinkInner,
  setWikiLinkDeadLookup,
  wikiLink,
  wikiLinkAt,
} from "@/lib/wiki-link";

describe("WIKI_LINK_RE", () => {
  it("matches a simple [[slug]]", () => {
    const m = "hello [[world]] there".match(WIKI_LINK_RE);
    expect(m).toEqual(["[[world]]"]);
  });

  it("matches aliased [[display|slug]] tokens", () => {
    const m = "see [[Họp team|hop-team]] please".match(WIKI_LINK_RE);
    expect(m).toEqual(["[[Họp team|hop-team]]"]);
  });

  it("matches multiple [[slug]] tokens in one line", () => {
    const m = "see [[a]] and [[b]] or [[c]]".match(WIKI_LINK_RE);
    expect(m).toEqual(["[[a]]", "[[b]]", "[[c]]"]);
  });

  it("does not match a single [bracket](link)", () => {
    const m = "hello [world](url) there".match(WIKI_LINK_RE);
    expect(m).toBeNull();
  });

  it("does not match unterminated [[foo", () => {
    expect("hello [[foo there".match(WIKI_LINK_RE)).toBeNull();
  });

  it("does not cross newlines", () => {
    expect("[[foo\nbar]]".match(WIKI_LINK_RE)).toBeNull();
  });
});

describe("parseWikiLinkInner / wikiLinkAt", () => {
  it("parses a plain slug as both display and target", () => {
    expect(parseWikiLinkInner("  hello  ")).toEqual({
      display: "hello",
      slug: "hello",
      aliased: false,
    });
  });

  it("parses [[display|slug]] with the slug as the navigation target", () => {
    expect(parseWikiLinkInner("Họp team|hop-team")).toEqual({
      display: "Họp team",
      slug: "hop-team",
      aliased: true,
    });
    const hit = wikiLinkAt("see [[Họp team|hop-team]] now", 6);
    expect(hit?.slug).toBe("hop-team");
    expect(hit?.display).toBe("Họp team");
  });

  it("rejects empty sides of an alias", () => {
    expect(parseWikiLinkInner("|slug")).toBeNull();
    expect(parseWikiLinkInner("label|")).toBeNull();
    expect(parseWikiLinkInner("   ")).toBeNull();
  });
});

describe("expandWikiLinks", () => {
  it("expands a single wiki link to markdown link", () => {
    expect(expandWikiLinks("see [[hello]]")).toBe("see [hello](/hello)");
  });

  it("uses display text for aliased links and encodes the slug href", () => {
    expect(expandWikiLinks("see [[Họp team|hop-team]]")).toBe("see [Họp team](/hop-team)");
    expect(expandWikiLinks("[[Label|hello world]]")).toBe(
      `[Label](/${encodeURIComponent("hello world")})`,
    );
  });

  it("does not emit raw HTML from alias display text", () => {
    expect(expandWikiLinks("[[<img src=x>|safe]]")).toBe("[img src=x](/safe)");
    expect(expandWikiLinks("[[<script>alert(1)</script>|safe]]")).not.toMatch(/<script>/i);
  });

  it("expands multiple wiki links in one call", () => {
    expect(expandWikiLinks("[[a]] and [[b]]")).toBe("[a](/a) and [b](/b)");
  });

  it("trims whitespace inside the brackets for the target", () => {
    expect(expandWikiLinks("[[  hello  ]]")).toBe("[hello](/hello)");
    expect(expandWikiLinks("[[ Display | slug ]]")).toBe("[Display](/slug)");
  });

  it("url-encodes slugs with spaces or unicode", () => {
    expect(expandWikiLinks("[[hello world]]")).toBe("[hello world](/hello%20world)");
    expect(expandWikiLinks("[[nhà]]")).toBe(`[nhà](/${encodeURIComponent("nhà")})`);
  });

  it("leaves text without wiki links unchanged", () => {
    expect(expandWikiLinks("no links here")).toBe("no links here");
    expect(expandWikiLinks("a [real](link) stays")).toBe("a [real](link) stays");
  });

  it("leaves empty [[ ]] alone", () => {
    // Regex requires at least one non-bracket char, so empty is skipped.
    expect(expandWikiLinks("[[]]")).toBe("[[]]");
  });

  it("leaves [[slug]] inside inline code untouched", () => {
    expect(expandWikiLinks("use `[[slug]]` to link")).toBe(
      "use `[[slug]]` to link",
    );
  });

  it("leaves [[slug]] inside a fenced code block untouched", () => {
    const input = "before\n```\nsee [[x]]\n```\nafter [[y]]";
    const output = "before\n```\nsee [[x]]\n```\nafter [y](/y)";
    expect(expandWikiLinks(input)).toBe(output);
  });

  it("leaves [[slug]] inside a tilde-fenced code block untouched", () => {
    const input = "before\n~~~\nsee [[x]]\n~~~\nafter [[y]]";
    const output = "before\n~~~\nsee [[x]]\n~~~\nafter [y](/y)";
    expect(expandWikiLinks(input)).toBe(output);
  });
});

describe("extractWikiLinks", () => {
  it("extracts plain and aliased targets while skipping code", () => {
    const links = extractWikiLinks("[[a]] `[[no]]` [[Label|b]]\n```\n[[nope]]\n```");
    expect(links.map((link) => link.slug)).toEqual(["a", "b"]);
    expect(links[1]).toMatchObject({ display: "Label", slug: "b", aliased: true });
  });
});

describe("wikiLink decorations", () => {
  afterEach(() => {
    setWikiLinkDeadLookup(null);
  });

  it("marks unknown targets as dead once a lookup has evidence", () => {
    setWikiLinkDeadLookup((slug) => slug !== "live");
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "[[live]] [[ghost]] [[Label|ghost]]",
        extensions: wikiLink(),
      }),
      parent,
    });
    const html = view.dom.innerHTML;
    expect(html).toContain("cm-wiki-link");
    expect(html).toContain("cm-wiki-link-dead");
    view.destroy();
  });
});
