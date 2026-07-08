import { describe, expect, it } from "vitest";
import { sanitizeUrl } from "@/lib/url-sanitize";

describe("sanitizeUrl", () => {
  it("keeps whitelisted params and strips everything else", () => {
    const out = sanitizeUrl("/my-note?foo=bar&extra=1", { allowedParams: ["foo"] });
    expect(out).toBe("/my-note?foo=bar");
  });

  it.each(["v", "ver", "version", "t", "ts", "nocache", "cachebust", "cb", "_"])(
    "always removes cache-buster param ?%s= even when whitelisted",
    (key) => {
      const out = sanitizeUrl(`/note?${key}=123&foo=bar`, { allowedParams: ["foo", key] });
      expect(out).toBe("/note?foo=bar");
    },
  );

  it("preserves pathname and hash", () => {
    const out = sanitizeUrl("/note/abc?v=9&x=1#section", { allowedParams: ["x"] });
    expect(out).toBe("/note/abc?x=1#section");
  });

  it("returns clean pathname when nothing is allowed", () => {
    const out = sanitizeUrl("/note?v=1&foo=bar");
    expect(out).toBe("/note");
  });

  it("works with absolute URLs and keeps origin", () => {
    const out = sanitizeUrl("https://example.com/note?v=1&foo=bar", { allowedParams: ["foo"] });
    expect(out).toBe("https://example.com/note?foo=bar");
  });

  it("handles bare pathnames without an origin", () => {
    expect(sanitizeUrl("/note?v=1", { allowedParams: [] })).toBe("/note");
  });
});
