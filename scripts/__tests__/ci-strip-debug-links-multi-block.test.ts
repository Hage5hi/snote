// Pins that ci-strip-debug-links removes EVERY matching begin/end
// marker block when step-summary.md somehow accumulated multiple
// debug sections (e.g. from a pre-helper-era rerun, a bug in an old
// version of the append step, or manual edits).
import { describe, expect, it } from "vitest";
import {
  BEGIN_MARKER,
  END_MARKER,
  stripDebugLinksBlocks,
} from "../ci-strip-debug-links";

const mkBlock = (id: string) =>
  [
    BEGIN_MARKER,
    "---",
    "",
    `#### Debug artifacts (${id})`,
    `- [link-${id}](https://example.test/artifacts/${id})`,
    END_MARKER,
  ].join("\n");

describe("ci-strip-debug-links — multi-block removal", () => {
  it("removes 2 adjacent blocks and leaves no markers behind", () => {
    const md = ["# summary", "", mkBlock("a"), "", mkBlock("b"), ""].join("\n");
    const out = stripDebugLinksBlocks(md);
    expect(out).not.toContain(BEGIN_MARKER);
    expect(out).not.toContain(END_MARKER);
    expect(out).not.toContain("link-a");
    expect(out).not.toContain("link-b");
    expect(out).toContain("# summary");
  });

  it("removes 5 blocks interleaved with surrounding markdown", () => {
    const md = [
      "# summary",
      "intro",
      mkBlock("a"),
      "## section 1",
      "body 1",
      mkBlock("b"),
      "## section 2",
      mkBlock("c"),
      "body 2",
      mkBlock("d"),
      "## section 3",
      "body 3",
      mkBlock("e"),
      "outro",
    ].join("\n\n");
    const out = stripDebugLinksBlocks(md);
    // Every marker block + its contents is gone.
    for (const id of ["a", "b", "c", "d", "e"]) {
      expect(out).not.toContain(`link-${id}`);
      expect(out).not.toContain(`(${id})`);
    }
    expect(out).not.toContain(BEGIN_MARKER);
    expect(out).not.toContain(END_MARKER);
    // Every surrounding heading + body line survives.
    for (const line of [
      "# summary",
      "intro",
      "## section 1",
      "body 1",
      "## section 2",
      "body 2",
      "## section 3",
      "body 3",
      "outro",
    ]) {
      expect(out).toContain(line);
    }
  });

  it("collapses to empty (modulo trailing newlines) when the file is only blocks", () => {
    const md = [mkBlock("a"), "", mkBlock("b"), "", mkBlock("c")].join("\n");
    const out = stripDebugLinksBlocks(md);
    expect(out.trim()).toBe("");
  });

  it("removes a mix of LF and CRLF blocks in the same file", () => {
    const lf = mkBlock("lf");
    const crlf = mkBlock("crlf").replace(/\n/g, "\r\n");
    // Whole-file CRLF triggers the CRLF code path; both blocks must
    // still be detected because the splitter is `/\r?\n/`.
    const md = (`# summary\n\n${lf}\n\nmiddle\n\n${crlf}\n\nend\n`).replace(
      /\n/g,
      "\r\n",
    );
    const out = stripDebugLinksBlocks(md);
    expect(out).not.toContain(BEGIN_MARKER);
    expect(out).not.toContain("link-lf");
    expect(out).not.toContain("link-crlf");
    expect(out).toContain("# summary");
    expect(out).toContain("middle");
    expect(out).toContain("end");
  });

  it("removes all blocks even when there is no content between them", () => {
    const md = `${mkBlock("a")}\n${mkBlock("b")}\n${mkBlock("c")}\n`;
    const out = stripDebugLinksBlocks(md);
    expect(out.trim()).toBe("");
  });
});
