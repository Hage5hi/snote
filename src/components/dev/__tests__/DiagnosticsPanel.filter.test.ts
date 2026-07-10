import { describe, expect, it } from "vitest";
import { filterDiagEvents } from "@/components/dev/DiagnosticsPanel";

const events = [
  { id: 1, at: 0, kind: "warn" as const, message: "slow render", detail: "took 200ms" },
  { id: 2, at: 0, kind: "error" as const, message: "boom", detail: "TypeError foo" },
  {
    id: 3,
    at: 0,
    kind: "react" as const,
    message: "render crash",
    componentStack: "at MyButton\n  at Panel",
  },
  { id: 4, at: 0, kind: "exception" as const, message: "uncaught", detail: "network" },
];

describe("filterDiagEvents", () => {
  it("returns all when no filter/query", () => {
    expect(filterDiagEvents(events, {}).map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });

  it("filters by kind", () => {
    expect(filterDiagEvents(events, { kind: "error" }).map((e) => e.id)).toEqual([2]);
  });

  it("matches query against message (case-insensitive)", () => {
    expect(filterDiagEvents(events, { query: "BOOM" }).map((e) => e.id)).toEqual([2]);
  });

  it("matches query against detail", () => {
    expect(filterDiagEvents(events, { query: "200ms" }).map((e) => e.id)).toEqual([1]);
  });

  it("matches query against componentStack", () => {
    expect(filterDiagEvents(events, { query: "mybutton" }).map((e) => e.id)).toEqual([3]);
  });

  it("combines kind and query", () => {
    expect(
      filterDiagEvents(events, { kind: "error", query: "typeerror" }).map((e) => e.id),
    ).toEqual([2]);
    expect(
      filterDiagEvents(events, { kind: "warn", query: "typeerror" }),
    ).toEqual([]);
  });

  it("ignores whitespace-only query", () => {
    expect(filterDiagEvents(events, { query: "   " })).toHaveLength(4);
  });
});
