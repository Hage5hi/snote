// Focused unit test for the pure live-region announcement dedupe
// reducer used by the HTML report's aria-live wiring. The Playwright
// spec pins the end-to-end behavior; this pins the algorithm so a
// regression in the reducer fails in milliseconds instead of via a
// flaky headless-browser run.
import { describe, expect, it } from "vitest";
import { dedupeAnnouncement } from "../_helpers/focus-trap-inspect";

describe("dedupeAnnouncement", () => {
  it("appends a new distinct message", () => {
    expect(dedupeAnnouncement([], "3 results")).toEqual(["3 results"]);
    expect(dedupeAnnouncement(["3 results"], "1 result")).toEqual(["3 results", "1 result"]);
  });

  it("collapses consecutive duplicates (no stale re-announcement)", () => {
    const log = ["3 results"];
    expect(dedupeAnnouncement(log, "3 results")).toEqual(["3 results"]);
    // Whitespace-only differences count as duplicates after trim.
    expect(dedupeAnnouncement(log, "  3 results  ")).toEqual(["3 results"]);
  });

  it("rejects empty / whitespace-only announcements", () => {
    expect(dedupeAnnouncement(["a"], "")).toEqual(["a"]);
    expect(dedupeAnnouncement(["a"], "   ")).toEqual(["a"]);
    expect(dedupeAnnouncement([], "")).toEqual([]);
  });

  it("allows a message to repeat after a different one (A,B,A)", () => {
    let log: string[] = [];
    log = dedupeAnnouncement(log, "3 results");
    log = dedupeAnnouncement(log, "1 result");
    log = dedupeAnnouncement(log, "3 results");
    expect(log).toEqual(["3 results", "1 result", "3 results"]);
  });

  it("simulated rapid toggles never produce two identical adjacent entries", () => {
    const stream = [
      "5 results", "5 results", "5 results",  // debounced input burst
      "2 results", "2 results",
      "", "  ",                                // spurious empties
      "5 results",                             // re-open disclosure
      "5 results",
    ];
    let log: string[] = [];
    for (const s of stream) log = dedupeAnnouncement(log, s);
    expect(log).toEqual(["5 results", "2 results", "5 results"]);
    for (let i = 1; i < log.length; i++) expect(log[i]).not.toBe(log[i - 1]);
  });

  it("returns a new array — does not mutate the input log", () => {
    const log = ["a"];
    const next = dedupeAnnouncement(log, "b");
    expect(log).toEqual(["a"]);
    expect(next).not.toBe(log);
  });
});
