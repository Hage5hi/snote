// Unit tests for scripts/ci-strip-debug-links.ts — the helper the CI
// "Append artifact links to step-summary.md" step calls to keep the
// appended block idempotent across reruns of the same step.
//
// Coverage:
//   • single block removed cleanly
//   • multiple stacked blocks (simulating multiple reruns) all removed
//   • non-block content is preserved verbatim
//   • CRLF line endings round-trip safely
//   • simulated "rerun" flow: strip + append yields the same result
//     whether run once or twice (the actual idempotency guarantee)
import { describe, expect, it } from "vitest";
import {
  BEGIN_MARKER,
  END_MARKER,
  stripDebugLinksBlocks,
} from "../ci-strip-debug-links";

const block = (body: string) =>
  [BEGIN_MARKER, "---", "", "#### Debug artifacts", body, END_MARKER].join("\n");

const append = (existing: string, body: string) =>
  (existing.endsWith("\n") ? existing : existing + "\n") + "\n" + block(body);

describe("ci-strip-debug-links", () => {
  it("removes a single debug-links block (markers + content)", () => {
    const md = `# summary\n\nbody\n\n${block("- [a](u)")}`;
    const out = stripDebugLinksBlocks(md);
    expect(out).not.toContain(BEGIN_MARKER);
    expect(out).not.toContain(END_MARKER);
    expect(out).not.toContain("Debug artifacts");
    expect(out).toContain("# summary");
    expect(out).toContain("body");
  });

  it("removes multiple stacked blocks left by earlier failed reruns", () => {
    const md = [
      "# summary",
      "body",
      block("- [run1](u1)"),
      block("- [run2](u2)"),
      block("- [run3](u3)"),
    ].join("\n\n");
    const out = stripDebugLinksBlocks(md);
    expect(out).not.toContain(BEGIN_MARKER);
    expect(out).not.toContain("run1");
    expect(out).not.toContain("run2");
    expect(out).not.toContain("run3");
    expect(out).toContain("# summary");
  });

  it("preserves non-block content verbatim when no markers present", () => {
    const md = "# summary\n\n## section\n\n- item\n";
    expect(stripDebugLinksBlocks(md)).toBe("# summary\n\n## section\n\n- item");
  });

  it("handles CRLF line endings without corrupting them", () => {
    const md = `# summary\r\n\r\n${block("- [a](u)").replace(/\n/g, "\r\n")}\r\n`;
    const out = stripDebugLinksBlocks(md);
    expect(out).not.toContain(BEGIN_MARKER);
    expect(out).toContain("\r\n");
    expect(out).toContain("# summary");
  });

  it("strip + append on rerun produces the SAME output as the first append (idempotent)", () => {
    // This is the core CI invariant: running the step twice must not
    // accumulate stacked blocks in reports/_ci/step-summary.md.
    const base = "# summary\n\nbody\n";
    const firstAppend = append(base, "- [run1](u1)");
    // Second invocation: strip prior block, then append a (potentially
    // different) link list — matches what the CI step does.
    const stripped = stripDebugLinksBlocks(firstAppend);
    const secondAppend = append(stripped, "- [run1](u1)");
    expect(secondAppend.trim()).toBe(firstAppend.trim());
    // And only one BEGIN marker survives, regardless of how many reruns.
    const count = (secondAppend.match(new RegExp(BEGIN_MARKER, "g")) ?? []).length;
    expect(count).toBe(1);
  });
});
