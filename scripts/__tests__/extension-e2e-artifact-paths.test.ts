// Guards the extension-e2e failure-evidence upload against path drift.
//
// Playwright resolves outputDir and the HTML reporter's outputFolder
// relative to the config file's directory (e2e-extension/), so the workflow
// must upload e2e-extension/<dir> — a root-relative copy of the old paths
// once produced artifacts containing only the extension source and the
// shipped zip, with no actual failure evidence inside.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/extension-e2e.yml", "utf8");
const playwrightConfig = readFileSync(
  "e2e-extension/playwright.config.ts",
  "utf8",
);

const outputDir = playwrightConfig.match(/outputDir:\s*"([^"]+)"/)?.[1];
const reportFolder = playwrightConfig.match(
  /outputFolder:\s*"([^"]+)"/,
)?.[1];

// Extract exactly the "Upload failure evidence" step, then exactly its
// path block — slicing to EOF would let unrelated later steps leak into
// the assertion. The upload step is the workflow's last step today; the
// next-step marker simply falls back to end-of-file when that changes.
const stepStart = workflow.indexOf("- name: Upload failure evidence");
const nextStep = workflow.indexOf("\n      - ", stepStart + 1);
const stepEnd = nextStep === -1 ? workflow.length : nextStep;
const step = stepStart === -1 ? "" : workflow.slice(stepStart, stepEnd);

const pathBlockMatch = step.match(/path: \|\n([\s\S]*?)\n\s{10}if-no-files-found:/);

describe("extension-e2e failure evidence artifact paths", () => {
  it("has exactly one Upload failure evidence step with a parseable path block", () => {
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    expect(pathBlockMatch).not.toBeNull();
  });

  it("resolves the Playwright output locations from the config", () => {
    expect(outputDir).toBe("test-results");
    expect(reportFolder).toBe("playwright-report");
  });

  it("uploads the evidence from under the config directory", () => {
    const uploadPaths = (pathBlockMatch?.[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(uploadPaths).toEqual([
      `e2e-extension/${reportFolder}/`,
      `e2e-extension/${outputDir}/`,
    ]);
  });

  it("does not substitute source or shipped archives for evidence", () => {
    const paths = pathBlockMatch?.[1] ?? "";
    expect(paths).not.toContain("chrome-extension/");
    expect(paths).not.toContain("syrin-note-sidepanel.zip");
  });

  it("fails the upload when the paths drift instead of uploading nothing", () => {
    expect(step).toMatch(/if-no-files-found:\s*error/);
  });

  it("actually runs the suite with the e2e-extension Playwright config", () => {
    expect(workflow).toContain(
      "--config=e2e-extension/playwright.config.ts",
    );
  });
});
