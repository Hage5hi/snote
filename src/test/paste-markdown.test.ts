import { describe, it, expect } from "vitest";
import { fixTurndownLinks, isPureHttpUrl } from "@/lib/paste-markdown";

describe("fixTurndownLinks", () => {
  it("inserts a space between URL and title when missing", () => {
    const input = '[foo](https://example.com"Foo")';
    expect(fixTurndownLinks(input)).toBe('[foo](https://example.com "Foo")');
  });

  it("is idempotent when space is already present", () => {
    const input = '[foo](https://example.com "Foo")';
    expect(fixTurndownLinks(input)).toBe(input);
  });

  it("leaves titleless links untouched", () => {
    const input = "[foo](https://example.com)";
    expect(fixTurndownLinks(input)).toBe(input);
  });

  it("fixes multiple links in the same document", () => {
    const input =
      '[a](https://a.example"A") and [b](https://b.example"B")';
    expect(fixTurndownLinks(input)).toBe(
      '[a](https://a.example "A") and [b](https://b.example "B")',
    );
  });

  it("handles URLs with fragments and query strings", () => {
    const input = '[sec](https://example.com/page?x=1#s"Section")';
    expect(fixTurndownLinks(input)).toBe(
      '[sec](https://example.com/page?x=1#s "Section")',
    );
  });

  it("handles empty title string", () => {
    const input = '[x](https://example.com"")';
    expect(fixTurndownLinks(input)).toBe('[x](https://example.com "")');
  });
});

describe("isPureHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isPureHttpUrl("http://example.com")).toBe(true);
    expect(isPureHttpUrl("https://example.com")).toBe(true);
    expect(isPureHttpUrl("https://a.b/c?d=1#e")).toBe(true);
  });

  it("trims leading/trailing whitespace", () => {
    expect(isPureHttpUrl("  https://example.com  ")).toBe(true);
    expect(isPureHttpUrl("\nhttps://example.com\n")).toBe(true);
  });

  it("rejects text that isn't a URL", () => {
    expect(isPureHttpUrl("hello world")).toBe(false);
    expect(isPureHttpUrl("")).toBe(false);
    expect(isPureHttpUrl("example.com")).toBe(false);
  });

  it("rejects URLs with surrounding text", () => {
    expect(isPureHttpUrl("see https://example.com today")).toBe(false);
    expect(isPureHttpUrl("https://example.com and more")).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(isPureHttpUrl("ftp://example.com")).toBe(false);
    expect(isPureHttpUrl("mailto:a@b.c")).toBe(false);
    expect(isPureHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isPureHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects www without scheme", () => {
    expect(isPureHttpUrl("www.example.com")).toBe(false);
  });
});
