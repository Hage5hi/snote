import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EXPECTED_BUN_VERSION = "1.3.14";
const ACTIONLINT_IMAGE =
  "docker://rhysd/actionlint@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9";
const WORKFLOW_FILES = readdirSync(".github/workflows")
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => `.github/workflows/${name}`);

const workflows = new Map(
  WORKFLOW_FILES.map((path) => [path, readFileSync(path, "utf8")]),
);
const allWorkflows = [...workflows.values()].join("\n");
const ci = workflows.get(".github/workflows/ci.yml")!;
const workflowStructure = workflows.get(".github/workflows/workflow-structure.yml")!;
const extensionWorkflow = workflows.get(".github/workflows/extension-e2e.yml")!;
const extensionAudit = readFileSync("scripts/audit-extension.sh", "utf8");
const securityFindings = readFileSync("docs/security-findings.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  packageManager?: string;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides?: Record<string, string>;
};
const toolsConfig = JSON.parse(readFileSync("tsconfig.tools.json", "utf8")) as {
  compilerOptions?: { strict?: boolean };
  include?: string[];
};

describe("CI toolchain contract", () => {
  it("pins one Bun version in package metadata and every workflow", () => {
    expect(packageJson.packageManager).toBe(`bun@${EXPECTED_BUN_VERSION}`);

    let setupCount = 0;
    for (const [path, workflow] of workflows) {
      const lines = workflow.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.includes("oven-sh/setup-bun@v2")) return;
        setupCount += 1;
        expect(
          lines.slice(index, index + 4).join("\n"),
          `${path} setup-bun step must pin Bun ${EXPECTED_BUN_VERSION}`,
        ).toMatch(new RegExp(`bun-version:\\s*["']?${EXPECTED_BUN_VERSION.replaceAll(".", "\\.")}["']?(?:\\s|}|$)`));
      });
    }

    expect(setupCount).toBeGreaterThan(0);
    expect(allWorkflows).not.toMatch(/bun-version:\s*latest\b/);
  });

  it("uses bun.lock in every workflow path and cache key", () => {
    expect(allWorkflows).not.toContain("bun.lockb");
  });

  it("keeps patched Vitest and its V8 coverage provider on 3.2.6", () => {
    expect(packageJson.devDependencies.vitest).toBe("3.2.6");
    expect(packageJson.devDependencies["@vitest/coverage-v8"]).toBe("3.2.6");
    expect(packageJson.scripts["test:coverage"]).toBe("vitest run --coverage");
  });

  it("records why the Vite major security exception cannot stay on Vite 5", () => {
    expect(packageJson.devDependencies.vite).toBe("^6.4.3");
    expect(packageJson.overrides?.vite).toBe("^6.4.3");
    expect(securityFindings).toContain("GHSA-fx2h-pf6j-xcff");
    expect(securityFindings).toContain("there is no patched Vite 5 release");
    expect(securityFindings).toContain("GHSA-5xrq-8626-4rwp");
  });

  it("runs explicit app, node and tools TypeScript projects", () => {
    expect(ci).not.toMatch(/bunx tsc --noEmit\s*$/m);
    for (const project of ["app", "node", "tools"]) {
      expect(ci).toContain(`bunx tsc --noEmit -p tsconfig.${project}.json`);
    }
  });

  it("covers scripts, e2e and TypeScript config files without enabling strict globally", () => {
    expect(toolsConfig.compilerOptions?.strict).toBe(false);
    expect(toolsConfig.include).toEqual(
      expect.arrayContaining([
        "scripts/**/*.ts",
        "e2e/**/*.ts",
        "e2e-extension/**/*.ts",
        "chrome-extension/**/*.ts",
        "vite.config.ts",
        "vitest.config.ts",
        "playwright.config.ts",
        "tailwind.config.ts",
      ]),
    );
  });

  it("removes incompatible broad overrides", () => {
    for (const name of [
      "ajv",
      "esbuild",
      "glob",
      "minimatch",
      "@tootallnate/once",
      "brace-expansion",
    ]) {
      expect(packageJson.overrides ?? {}).not.toHaveProperty(name);
    }
  });

  it("cancels stale runs for pull-request workflows", () => {
    const pullRequestWorkflows = [...workflows].filter(([, workflow]) =>
      /^  pull_request:/m.test(workflow),
    );
    expect(pullRequestWorkflows.length).toBeGreaterThan(0);

    for (const [path, workflow] of pullRequestWorkflows) {
      expect(
        workflow,
        `${path} must group runs by workflow and pull request/ref`,
      ).toContain(
        "group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
      );
      expect(workflow).toMatch(/cancel-in-progress:\s*true\b/);
    }
  });

  it("keeps one always-present stable quality gate", () => {
    expect(workflowStructure).toMatch(
      /^  pull_request:\s*\n  workflow_dispatch:/m,
    );
    expect(workflowStructure).not.toMatch(/^  actionlint:/m);

    const qualityJob = workflowStructure.slice(
      workflowStructure.indexOf("\n  quality:"),
    );
    expect(qualityJob).toContain("name: quality");
    expect(qualityJob).toContain(ACTIONLINT_IMAGE);
    expect(qualityJob).toContain("persist-credentials: false");
    expect(qualityJob).toMatch(
      /^[ \t]*(?:-[ \t]+)?run:[ \t]*bun run test[ \t]*$/m,
    );
    expect(qualityJob).toMatch(
      /^[ \t]*(?:-[ \t]+)?run:[ \t]*bun run test:coverage[ \t]*$/m,
    );
    expect(qualityJob).toMatch(
      /^[ \t]*(?:-[ \t]+)?run:[ \t]*bun run build:check[ \t]*$/m,
    );
    expect(qualityJob).toContain(
      "bunx playwright test --list --project=chromium",
    );
    const actionlintImages =
      allWorkflows.match(/docker:\/\/rhysd\/actionlint[^\s]*/g) ?? [];
    expect(actionlintImages.length).toBeGreaterThan(0);
    expect(new Set(actionlintImages)).toEqual(new Set([ACTIONLINT_IMAGE]));
  });

  it("keeps one stable PR E2E check context", () => {
    const e2ePrWorkflows = [...workflows]
      .filter(([, workflow]) => /(?:^|\r?\n)  e2e-pr:\r?\n/.test(workflow))
      .map(([path]) => path);
    expect(e2ePrWorkflows).toEqual([".github/workflows/e2e-new-specs.yml"]);

    const e2ePrWorkflow = workflows.get(e2ePrWorkflows[0])!;
    expect(e2ePrWorkflow).toMatch(
      /^  pull_request:\s*\n  workflow_dispatch:/m,
    );
    const e2ePrJobStart = e2ePrWorkflow.search(/(?:^|\r?\n)  e2e-pr:\r?\n/);
    expect(e2ePrJobStart).toBeGreaterThanOrEqual(0);
    const e2ePrJob = e2ePrWorkflow.slice(e2ePrJobStart);
    expect(e2ePrJob).toMatch(/^\s{4}name:\s*e2e-pr\s*$/m);
  });

  it("runs extension verification when its dependencies or audit scripts change", () => {
    for (const path of [
      "package.json",
      "bun.lock",
      "scripts/audit-extension.sh",
      "scripts/verify-extension-zip.sh",
    ]) {
      expect(extensionWorkflow.split(`- \"${path}\"`).length - 1).toBe(2);
    }
  });

  it("selects the audit command supported by pinned Bun", () => {
    expect(extensionAudit).toContain("bun audit --audit-level=high");
    expect(extensionAudit).not.toMatch(/bun audit[^\r\n]*--prod/);
    expect(extensionAudit).not.toMatch(/bun pm (?:audit|scan)/);
  });

  it("represents lint, unit, coverage, build and workflow-structure gates", () => {
    expect(ci).toContain("bun run lint");
    expect(ci).toContain("bun run test");
    expect(ci).toContain("bun run test:coverage");
    expect(ci).toContain("bun run build:check");
    expect(ci).toMatch(/\bactionlint\b/);
  });
});

