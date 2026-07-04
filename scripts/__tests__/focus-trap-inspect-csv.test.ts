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
      "", // failureReason empty for healthy rows
    ]);
  });

  it("quotes test titles containing commas", () => {
    const row = toCsvRow({ ...baseEntry, testTitle: "escapes, twice" });
    expect(row).toContain('"escapes, twice"');
  });

  it("quotes labels containing newlines without splitting the row", () => {
    const row = toCsvRow({ ...baseEntry, label: "a\nb" });
    expect(row).toContain('"a\nb"');
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

  it("surfaces schema/parse failures via the failureReason column", () => {
    const row = toCsvRow({ ...baseEntry, failureReason: "schema: /focusHistory [focusHistory]: required array" }).split(",");
    // failureReason is the last column and is quoted (contains commas/colons safe, but the value here has none).
    expect(CSV_COLUMNS[CSV_COLUMNS.length - 1]).toBe("failureReason");
    expect(row[row.length - 1]).toContain("schema:");
  });
});

describe("validateFocusTrapPayload", () => {
  it("accepts a minimal well-formed payload", () => {
    expect(validateFocusTrapPayload({ focusHistory: [{ event: "beforeOpen" }] })).toEqual([]);
  });

  it("rejects non-object payloads with a JSON pointer and value snippet", () => {
    const errs = validateFocusTrapPayload(null);
    expect(errs[0]).toMatchObject({ pointer: "", field: "payload", message: "expected top-level object" });
    expect(errs[0].value).toBe("null");
    const errs2 = validateFocusTrapPayload([]);
    expect(errs2[0].field).toBe("payload");
  });

  it("requires focusHistory to be an array of entries with string events, pinning JSON pointers", () => {
    const missing = validateFocusTrapPayload({});
    expect(missing[0]).toMatchObject({ pointer: "/focusHistory", field: "focusHistory" });

    const badEvent = validateFocusTrapPayload({ focusHistory: [{ event: 42 }] });
    expect(badEvent[0]).toMatchObject({ pointer: "/focusHistory/0/event", field: "event", message: "expected string" });
    expect(badEvent[0].value).toBe("42");
  });
});
