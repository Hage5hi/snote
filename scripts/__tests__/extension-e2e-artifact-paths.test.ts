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

const uploadBlock = workflow.slice(
  workflow.indexOf("Upload failure evidence"),
);
const uploadPaths = [
  ...uploadBlock.matchAll(/^\s{12}(\S+)\s*$/gm),
].map((m) => m[1]);

describe("extension-e2e failure evidence artifact paths", () => {
  it("resolves the Playwright output locations from the config", () => {
    expect(outputDir).toBe("test-results");
    expect(reportFolder).toBe("playwright-report");
  });

  it("uploads the evidence from under the config directory", () => {
    expect(uploadPaths).toEqual([
      `e2e-extension/${reportFolder}/`,
      `e2e-extension/${outputDir}/`,
    ]);
  });

  it("does not substitute source or shipped archives for evidence", () => {
    expect(uploadPaths).not.toContain("chrome-extension/");
    expect(uploadPaths.join(" ")).not.toContain("syrin-note-sidepanel.zip");
  });

  it("fails the upload when the paths drift instead of uploading nothing", () => {
    expect(uploadBlock).toMatch(/if-no-files-found:\s*error/);
  });
});
