import { describe, it, expect } from "vitest";
import { isValidSlug, SLUG_RE } from "../lib/validate-slug.js";

describe("isValidSlug", () => {
  it("rejects empty string", () => expect(isValidSlug("")).toBe(false));
  it("rejects undefined", () => expect(isValidSlug(undefined)).toBe(false));
  it("rejects non-string", () => expect(isValidSlug(123)).toBe(false));
  it("accepts 1 char", () => expect(isValidSlug("a")).toBe(true));
  it("accepts 64 chars", () => expect(isValidSlug("a".repeat(64))).toBe(true));
  it("rejects 65 chars", () => expect(isValidSlug("a".repeat(65))).toBe(false));
  it("accepts hyphens", () => expect(isValidSlug("my-note")).toBe(true));
  it("accepts underscores", () => expect(isValidSlug("my_note")).toBe(true));
  it("accepts digits", () => expect(isValidSlug("note-123")).toBe(true));
  it("accepts uppercase", () => expect(isValidSlug("MyNote")).toBe(true));
  it("rejects spaces", () => expect(isValidSlug("my note")).toBe(false));
  it("rejects unicode", () => expect(isValidSlug("ghi-chú")).toBe(false));
  it("rejects slash", () => expect(isValidSlug("a/b")).toBe(false));
  it("rejects dot", () => expect(isValidSlug("a.b")).toBe(false));
  it("regex is the documented one", () =>
    expect(SLUG_RE.source).toBe("^[a-zA-Z0-9_-]{1,64}$"));
});
