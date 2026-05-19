// Unit tests proving buildCoverageComment NEVER renders a broken
// artifact link when artifact ids are empty strings, whitespace, or
// undefined — across every slot and every combination. Catches a
// regression where (e.g.) someone replaces the trim() check with a
// truthy check (which would let "   " through and render
// `(<runUrl>/artifacts/   )`).
//
// Rules enforced for every degraded slot:
//   • no "/artifacts/<id>" url is present for the missing slot
//   • the slot's label appears in the explicit "_… : artifact not
//     uploaded for this run_" notice naming the artifact
//   • no markdown link with an empty / whitespace-only URL anywhere
//     (regex: `\]\(\s*\)` or `\]\(.*/artifacts/\s*\)`)
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/42";

const DEGRADED_IDS: Array<string | undefined> = [
  undefined,
  "",
  " ",
  "   ",
  "\t",
  "\n",
  " \t \n ",
];

interface Slot {
  key:
    | "coverageArtifactId"
    | "debugBundleArtifactId"
    | "stepSummaryArtifactId"
    | "failureBreakdownArtifactId";
  label: string;
}

const SLOTS: Slot[] = [
  { key: "coverageArtifactId", label: "📊 HTML coverage report" },
  { key: "debugBundleArtifactId", label: "📦 debug-bundle" },
  { key: "stepSummaryArtifactId", label: "📝 step-summary.md" },
  { key: "failureBreakdownArtifactId", label: "🧩 failure-breakdown.json" },
];

const ALL_PRESENT = {
  coverageArtifactId: "cov-1",
  debugBundleArtifactId: "deb-1",
  stepSummaryArtifactId: "step-1",
  failureBreakdownArtifactId: "fb-1",
};

/** Hard structural checks that must hold for ANY rendered body. */
const expectNoBrokenLinks = (body: string) => {
  // No empty-target markdown links anywhere.
  expect(body).not.toMatch(/\]\(\s*\)/);
  // No `/artifacts/` link with an empty / whitespace-only id.
  expect(body).not.toMatch(/\]\([^)]*\/artifacts\/\s*\)/);
  expect(body).not.toMatch(/\]\([^)]*\/artifacts\/\)/);
};

describe("buildCoverageComment — never renders broken links (success variant)", () => {
  for (const slot of SLOTS) {
    describe(`slot=${slot.key}`, () => {
      it.each(DEGRADED_IDS)("degrades safely for id=%j", (id) => {
        const body = buildCoverageComment({
          runUrl: RUN,
          validateOutcome: "success",
          ...ALL_PRESENT,
          [slot.key]: id,
        });
        expectNoBrokenLinks(body);
        // The degraded slot is explicitly named in the "not uploaded"
        // notice — reviewers see WHICH artifact is missing, not just
        // a stale link.
        expect(body).toContain(
          `_${slot.label}: artifact not uploaded for this run_`,
        );
        // Other slots still render normally.
        for (const other of SLOTS) {
          if (other.key === slot.key) continue;
          const presentId = ALL_PRESENT[other.key];
          expect(body).toContain(`${RUN}/artifacts/${presentId}`);
        }
      });
    });
  }

  it("ALL slots degraded simultaneously — no broken links anywhere", () => {
    for (const id of DEGRADED_IDS) {
      const body = buildCoverageComment({
        runUrl: RUN,
        validateOutcome: "success",
        coverageArtifactId: id,
        debugBundleArtifactId: id,
        stepSummaryArtifactId: id,
        failureBreakdownArtifactId: id,
      });
      expectNoBrokenLinks(body);
      for (const slot of SLOTS) {
        expect(body).toContain(
          `_${slot.label}: artifact not uploaded for this run_`,
        );
      }
      expect(body).not.toContain(`${RUN}/artifacts/`);
    }
  });
});

describe("buildCoverageComment — never renders broken links (validator-failed variant)", () => {
  it.each(DEGRADED_IDS)("suppression body has no artifact links for id=%j", (id) => {
    const body = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "failure",
      coverageArtifactId: id,
      debugBundleArtifactId: id,
      stepSummaryArtifactId: id,
      failureBreakdownArtifactId: id,
    });
    expectNoBrokenLinks(body);
    expect(body).not.toContain(`/artifacts/`);
    expect(body).toContain("Breakdown JSON validation failed");
  });
});
