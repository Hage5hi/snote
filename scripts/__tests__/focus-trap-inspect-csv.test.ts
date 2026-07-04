// Pins the CSV contract of scripts/inspect-focus-trap.ts:
//   • column order (downstream CI jobs index by position)
//   • RFC-4180-style escaping for commas, quotes, newlines, CR
//   • correct handling of null/undefined and nested firstEscape/relocate
//
// These are the fields most likely to contain user-controlled strings
// (spec paths, test titles), so drifting quoting silently would corrupt
// every consumer's parse.
import { describe, expect, it } from "vitest";

import {
  CSV_COLUMNS,
  escCsv,
  toCsvRow,
  validateFocusTrapPayload,
} from "../_helpers/focus-trap-inspect";

describe("escCsv", () => {
  it("passes plain values through unquoted", () => {
    expect(escCsv("hello")).toBe("hello");
    expect(escCsv(42)).toBe("42");
    expect(escCsv(true)).toBe("true");
  });

  it("renders null/undefined as empty string", () => {
    expect(escCsv(null)).toBe("");
    expect(escCsv(undefined)).toBe("");
  });

  it("quotes values containing a comma", () => {
    expect(escCsv("a,b")).toBe('"a,b"');
  });

  it("quotes and escapes embedded double quotes", () => {
    expect(escCsv('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes values with newlines and carriage returns", () => {
    expect(escCsv("line1\nline2")).toBe('"line1\nline2"');
    expect(escCsv("cr\rlf")).toBe('"cr\rlf"');
  });
});

describe("toCsvRow", () => {
  const baseEntry = {
    file: "test-results/foo/focus-trap-escape-x.json",
    spec: "foo",
    browser: "chromium",
    attempt: 1,
    label: "x",
    testTitle: "escapes trap",
    firstEscape: { event: "afterTab", perf: 12.5 },
    relocate: { path: "stable-attribute", usedFallback: true },
    iterTimings: { iter0: {}, iter1: {} },
  };

  it("emits values in the pinned column order", () => {
    const row = toCsvRow(baseEntry).split(",");
    expect(CSV_COLUMNS.length).toBe(row.length);
    expect(row).toEqual([
      "test-results/foo/focus-trap-escape-x.json",
      "foo", "chromium", "1", "x", "escapes trap",
      "afterTab", "12.5",
      "stable-attribute", "true",
      "2",
    ]);
  });

  it("quotes test titles containing commas", () => {
    const row = toCsvRow({ ...baseEntry, testTitle: "escapes, twice" });
    expect(row).toContain('"escapes, twice"');
  });

  it("quotes labels containing newlines without splitting the row", () => {
    const row = toCsvRow({ ...baseEntry, label: "a\nb" });
    // The escaped label must appear as a single quoted field, not split.
    expect(row).toContain('"a\nb"');
    // Row still has exactly N-1 unquoted commas separating N fields
    // (commas inside the quoted label do not count).
    const outsideQuotes = row.replace(/"[^"]*"/g, "");
    expect(outsideQuotes.split(",").length).toBe(CSV_COLUMNS.length);
  });

  it("escapes embedded double quotes in test titles", () => {
    const row = toCsvRow({ ...baseEntry, testTitle: 'has "quotes"' });
    expect(row).toContain('"has ""quotes"""');
  });

  it("renders missing firstEscape/relocate as empty fields", () => {
    const row = toCsvRow({ ...baseEntry, firstEscape: null, relocate: null, iterTimings: {} }).split(",");
    // firstEscapeEvent, firstEscapePerfMs, relocatePath, relocateUsedFallback, iterCount
    expect(row.slice(6, 11)).toEqual(["", "", "", "", "0"]);
  });
});

describe("validateFocusTrapPayload", () => {
  it("accepts a minimal well-formed payload", () => {
    expect(validateFocusTrapPayload({ focusHistory: [{ event: "beforeOpen" }] })).toEqual([]);
  });

  it("rejects non-object payloads", () => {
    expect(validateFocusTrapPayload(null)).toContain("payload: expected top-level object");
    expect(validateFocusTrapPayload([])).toContain("payload: expected top-level object");
  });

  it("requires focusHistory to be an array of entries with string events", () => {
    expect(validateFocusTrapPayload({})).toContain("focusHistory: required array");
    const errs = validateFocusTrapPayload({ focusHistory: [{ event: 42 }] });
    expect(errs.some((e) => e.includes("focusHistory[0].event"))).toBe(true);
  });
});
