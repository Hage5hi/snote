import { history, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  WIKI_KNOWN_CHANGE_EVENT,
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

  it("matches aliased [[slug|display]] tokens", () => {
    const m = "see [[hop-team|Họp team]] please".match(WIKI_LINK_RE);
    expect(m).toEqual(["[[hop-team|Họp team]]"]);
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

  it("does not match ![[transclude]] tokens", () => {
    expect("see ![[world]] there".match(WIKI_LINK_RE)).toBeNull();
    expect("see ![[world]] and [[other]]".match(WIKI_LINK_RE)).toEqual(["[[other]]"]);
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

  it("parses [[slug|display]] with the first segment as the navigation target", () => {
    expect(parseWikiLinkInner("hop-team|Họp team")).toEqual({
      display: "Họp team",
      slug: "hop-team",
      aliased: true,
    });
    const hit = wikiLinkAt("see [[hop-team|Họp team]] now", 6);
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
    expect(expandWikiLinks("see [[hop-team|Họp team]]")).toBe("see [Họp team](/hop-team)");
    expect(expandWikiLinks("[[hello-world|Label]]")).toBe("[Label](/hello-world)");
  });

  it("does not emit raw HTML from alias display text", () => {
    expect(expandWikiLinks("[[safe|<img src=x>]]")).toBe("[img src=x](/safe)");
    expect(expandWikiLinks("[[safe|<script>alert(1)</script>]]")).not.toMatch(/<script>/i);
  });

  it("expands multiple wiki links in one call", () => {
    expect(expandWikiLinks("[[a]] and [[b]]")).toBe("[a](/a) and [b](/b)");
  });

  it("trims whitespace inside the brackets for the target", () => {
    expect(expandWikiLinks("[[  hello  ]]")).toBe("[hello](/hello)");
    expect(expandWikiLinks("[[ slug | Display ]]")).toBe("[Display](/slug)");
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

  it("does not rewrite ![[slug]] into a markdown image", () => {
    expect(expandWikiLinks("![[recipes]]")).toBe("![[recipes]]");
    expect(expandWikiLinks("see ![[hop-team|Label]] and [[keep]]")).toBe(
      "see ![[hop-team|Label]] and [keep](/keep)",
    );
  });
});

describe("extractWikiLinks", () => {
  it("extracts plain and aliased targets while skipping code", () => {
    const links = extractWikiLinks("[[a]] `[[no]]` [[b|Label]]\n```\n[[nope]]\n```");
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
        doc: "[[live]] [[ghost]] [[ghost|Label]]",
        extensions: wikiLink(),
      }),
      parent,
    });
    const html = view.dom.innerHTML;
    expect(html).toContain("cm-wiki-link");
    expect(html).toContain("cm-wiki-link-dead");
    view.destroy();
  });

  it("does not add wiki-known refreshes to undo history", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "[[ghost]]",
        extensions: [history(), wikiLink()],
      }),
      parent,
    });
    view.dispatch({ changes: { from: 0, insert: "x" } });
    const depth = undoDepth(view.state);
    expect(depth).toBeGreaterThan(0);
    window.dispatchEvent(new Event(WIKI_KNOWN_CHANGE_EVENT));
    expect(undoDepth(view.state)).toBe(depth);
    view.destroy();
  });
});
