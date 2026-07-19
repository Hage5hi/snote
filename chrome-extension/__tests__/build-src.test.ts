import { describe, it, expect } from "vitest";
import { buildSrc, badgeForMode, DEFAULT_APP_ORIGIN } from "../lib/build-src.js";

describe("buildSrc", () => {
  it("home mode → root with from=ext", () => {
    expect(buildSrc({ openMode: "home" })).toBe(`${DEFAULT_APP_ORIGIN}/?from=ext`);
  });

  it("slug mode with valid slug → /slug?from=ext", () => {
    expect(buildSrc({ openMode: "slug", defaultSlug: "my-note" })).toBe(
      `${DEFAULT_APP_ORIGIN}/my-note?from=ext`,
    );
  });

  it("slug mode with empty slug → root fallback", () => {
    expect(buildSrc({ openMode: "slug", defaultSlug: "" })).toBe(
      `${DEFAULT_APP_ORIGIN}/?from=ext`,
    );
  });

  it("slug mode with invalid slug → root fallback", () => {
    expect(buildSrc({ openMode: "slug", defaultSlug: "has space" })).toBe(
      `${DEFAULT_APP_ORIGIN}/?from=ext`,
    );
  });

  it("last mode with valid lastSlug → /last?from=ext", () => {
    expect(buildSrc({ openMode: "last", lastSlug: "yesterday" })).toBe(
      `${DEFAULT_APP_ORIGIN}/yesterday?from=ext`,
    );
  });

  it("last mode with empty lastSlug → root fallback", () => {
    expect(buildSrc({ openMode: "last", lastSlug: "" })).toBe(
      `${DEFAULT_APP_ORIGIN}/?from=ext`,
    );
  });

  it("unknown mode → root fallback", () => {
    expect(buildSrc({ openMode: "garbage", defaultSlug: "x" })).toBe(
      `${DEFAULT_APP_ORIGIN}/?from=ext`,
    );
  });

  it("respects custom appOrigin", () => {
    expect(
      buildSrc({ openMode: "slug", defaultSlug: "x", appOrigin: "http://localhost:5173" }),
    ).toBe("http://localhost:5173/x?from=ext");
  });

  it("defaults openMode to home when omitted", () => {
    expect(buildSrc({})).toBe(`${DEFAULT_APP_ORIGIN}/?from=ext`);
  });
});

describe("badgeForMode", () => {
  it("returns H for home", () => expect(badgeForMode("home")).toBe("H"));
  it("returns S for slug", () => expect(badgeForMode("slug")).toBe("S"));
  it("returns L for last", () => expect(badgeForMode("last")).toBe("L"));
  it("returns H for unknown", () => expect(badgeForMode("xyz")).toBe("H"));
  it("returns H for undefined", () => expect(badgeForMode(undefined)).toBe("H"));
});
