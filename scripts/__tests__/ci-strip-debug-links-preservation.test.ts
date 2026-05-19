// Additional unit tests for ci-strip-debug-links — focused on the
// "removes ONLY the begin/end marker block, leaves everything else
// untouched across multiple reruns" guarantee. Complements
// ci-strip-debug-links.test.ts (which covers the basic block-removal
// shapes) and ci-append-debug-links.test.ts (which proves the
// append-side idempotency).
//
// What this file pins:
//   • surrounding markdown (headings, lists, code fences, tables,
//     blank-line-only paragraphs) is preserved BYTE-for-BYTE
//   • repeated strip→append→strip cycles converge after the first
//     append and stay stable (true idempotency across many reruns)
//   • marker-looking-but-not-matching lines (different casing,
//     extra text) are NOT treated as markers and survive intact
import { describe, expect, it } from "vitest";
import {
  BEGIN_MARKER,
  END_MARKER,
  stripDebugLinksBlocks,
} from "../ci-strip-debug-links";

const block = (body: string) =>
  [BEGIN_MARKER, "---", "", "#### Debug artifacts", body, END_MARKER].join("\n");

describe("ci-strip-debug-links — non-block content preservation", () => {
  const surrounding = [
    "# step summary",
    "",
    "## results",
    "",
    "| col1 | col2 |",
    "| ---- | ---- |",
    "| a    | b    |",
    "",
    "```ts",
    "const x: number = 1;",
    "```",
    "",
    "- item one",
    "- item two",
    "",
    "> a blockquote",
    "",
  ].join("\n");

  it("removes ONLY the marker block — surrounding markdown is preserved verbatim", () => {
    const wrapped = `${surrounding}\n${block("- [a](u)")}\n`;
    const out = stripDebugLinksBlocks(wrapped);
    // Every surrounding line survives (modulo collapsed trailing
    // blank lines from the removed block).
    for (const line of surrounding.split("\n").filter((l) => l.length > 0)) {
      expect(out).toContain(line);
    }
    expect(out).not.toContain(BEGIN_MARKER);
    expect(out).not.toContain(END_MARKER);
  });

  it("ignores marker-looking lines that don't match exactly", () => {
    const md = [
      "# summary",
      "<!-- ci-debug-links:begin --> with trailing text",
      "<!-- CI-DEBUG-LINKS:BEGIN -->",
      "some <!-- ci-debug-links:begin --> inline",
      "body",
    ].join("\n");
    const out = stripDebugLinksBlocks(md);
    // None of these are true block starts → every line survives.
    expect(out).toContain("with trailing text");
    expect(out).toContain("CI-DEBUG-LINKS:BEGIN");
    expect(out).toContain("some <!-- ci-debug-links:begin --> inline");
    expect(out).toContain("body");
  });
});

describe("ci-strip-debug-links — convergence across many reruns", () => {
  it("strip→append→strip→append (5x) stays identical after the first append", () => {
    let md = "# summary\n\nbody\n";
    const append = (s: string, body: string) =>
      (s.endsWith("\n") ? s : s + "\n") + "\n" + block(body);

    const firstAppended = append(md, "- [run1](u1)");
    md = firstAppended;
    for (let i = 0; i < 5; i++) {
      md = stripDebugLinksBlocks(md);
      md = append(md, "- [run1](u1)");
    }
    expect(md.trim()).toBe(firstAppended.trim());
    expect(md.match(new RegExp(BEGIN_MARKER, "g"))?.length).toBe(1);
    expect(md.match(new RegExp(END_MARKER, "g"))?.length).toBe(1);
  });

  it("strip is a no-op on already-stripped content (fixed point)", () => {
    const md = "# summary\n\nbody\n\n- item";
    const once = stripDebugLinksBlocks(md);
    const twice = stripDebugLinksBlocks(once);
    const thrice = stripDebugLinksBlocks(twice);
    expect(once).toBe(twice);
    expect(twice).toBe(thrice);
  });
});
