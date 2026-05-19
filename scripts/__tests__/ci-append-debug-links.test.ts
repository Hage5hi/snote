// Unit tests for scripts/ci-append-debug-links.ts. Pins:
//   • the EXACT begin/end markers required by ci-strip-debug-links for
//     idempotency (imported from the same source-of-truth module so a
//     drift in one immediately breaks this test)
//   • the link_or_missing degraded form for missing artifact ids
//   • the rewrite helper is idempotent across reruns: strip→append run
//     twice produces the same markdown as run once
//
// Together these prove the CI invariant: rerunning the "Append artifact
// links to step-summary.md" workflow step doesn't stack duplicate
// blocks and always emits markers that ci-strip-debug-links can find.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  renderDebugLinksBlock,
  renderLinkLine,
  rewriteStepSummaryWithDebugLinks,
} from "../ci-append-debug-links";
import {
  BEGIN_MARKER,
  END_MARKER,
  stripDebugLinksBlocks,
} from "../ci-strip-debug-links";

const RUN = "https://github.com/o/r/actions/runs/42";

describe("renderLinkLine", () => {
  it("emits a clickable bullet when id is present", () => {
    expect(renderLinkLine({ id: "abc", label: "📦 debug-bundle" }, RUN)).toBe(
      `- [📦 debug-bundle](${RUN}/artifacts/abc)`,
    );
  });
  it("emits a clearly-named missing bullet when id is empty / undefined", () => {
    expect(renderLinkLine({ label: "📝 step-summary.md" }, RUN)).toBe(
      "- _📝 step-summary.md: artifact not uploaded_",
    );
    expect(renderLinkLine({ id: "", label: "🧩 breakdown" }, RUN)).toBe(
      "- _🧩 breakdown: artifact not uploaded_",
    );
  });
});

describe("renderDebugLinksBlock", () => {
  const block = renderDebugLinksBlock({
    runUrl: RUN,
    header: "Debug artifacts",
    links: [
      { id: "id1", label: "📝 step-summary.md" },
      { id: "", label: "🧩 failure-breakdown.json" },
      { id: "id3", label: "📦 debug-bundle (all of the above + raw log)" },
    ],
  });

  it("emits the EXACT begin/end markers ci-strip-debug-links looks for", () => {
    const lines = block.split("\n");
    // First and last lines must be the markers themselves — no
    // surrounding whitespace, no prose, so the strip helper's
    // `trim() === MARKER` matcher always finds them.
    expect(lines[0]).toBe(BEGIN_MARKER);
    expect(lines[lines.length - 1]).toBe(END_MARKER);
    // And there is exactly one begin/end pair.
    expect(block.match(new RegExp(BEGIN_MARKER, "g"))?.length).toBe(1);
    expect(block.match(new RegExp(END_MARKER, "g"))?.length).toBe(1);
  });

  it("places the header + links between the markers", () => {
    expect(block).toContain("#### Debug artifacts");
    expect(block).toContain(`[📝 step-summary.md](${RUN}/artifacts/id1)`);
    expect(block).toContain("_🧩 failure-breakdown.json: artifact not uploaded_");
    expect(block).toContain(`[📦 debug-bundle`);
  });

  it("strip-then-render round-trips: the strip helper removes the whole block", () => {
    const wrapped = `# summary\n\nbody\n\n${block}\n`;
    const stripped = stripDebugLinksBlocks(wrapped);
    expect(stripped).not.toContain(BEGIN_MARKER);
    expect(stripped).not.toContain(END_MARKER);
    expect(stripped).not.toContain("Debug artifacts");
    expect(stripped).toContain("# summary");
  });
});

describe("rewriteStepSummaryWithDebugLinks (idempotency)", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ci-append-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("first run appends the block; second run replaces it (no stacking)", () => {
    const file = join(dir, "step-summary.md");
    writeFileSync(file, "# summary\n\nbody\n");
    const opts = {
      runUrl: RUN,
      header: "Debug artifacts (ubuntu-latest)",
      links: [{ id: "abc", label: "📦 debug-bundle" }],
    };
    rewriteStepSummaryWithDebugLinks(file, opts);
    const afterFirst = readFileSync(file, "utf8");
    rewriteStepSummaryWithDebugLinks(file, opts);
    const afterSecond = readFileSync(file, "utf8");
    expect(afterSecond.trim()).toBe(afterFirst.trim());
    // Exactly one begin marker in the file, no matter how many reruns.
    expect(afterSecond.match(new RegExp(BEGIN_MARKER, "g"))?.length).toBe(1);
  });

  it("creates the file when it doesn't exist yet", () => {
    const file = join(dir, "new.md");
    rewriteStepSummaryWithDebugLinks(file, {
      runUrl: RUN,
      header: "Debug artifacts",
      links: [{ id: "x", label: "📝 step-summary.md" }],
    });
    const out = readFileSync(file, "utf8");
    expect(out).toContain(BEGIN_MARKER);
    expect(out).toContain(END_MARKER);
  });
});
