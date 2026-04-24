import { describe, it, expect } from "vitest";
import { WIKI_LINK_RE, expandWikiLinks } from "@/lib/wiki-link";

describe("WIKI_LINK_RE", () => {
  it("matches a simple [[slug]]", () => {
    const m = "hello [[world]] there".match(WIKI_LINK_RE);
    expect(m).toEqual(["[[world]]"]);
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

describe("expandWikiLinks", () => {
  it("expands a single wiki link to markdown link", () => {
    expect(expandWikiLinks("see [[hello]]")).toBe("see [hello](/hello)");
  });

  it("expands multiple wiki links in one call", () => {
    expect(expandWikiLinks("[[a]] and [[b]]")).toBe("[a](/a) and [b](/b)");
  });

  it("trims whitespace inside the brackets for the target", () => {
    expect(expandWikiLinks("[[  hello  ]]")).toBe("[hello](/hello)");
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
