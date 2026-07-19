import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EXPECTED_BUN_VERSION = "1.3.14";
const WORKFLOW_FILES = readdirSync(".github/workflows")
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => `.github/workflows/${name}`);

const workflows = new Map(
  WORKFLOW_FILES.map((path) => [path, readFileSync(path, "utf8")]),
);
const allWorkflows = [...workflows.values()].join("\n");
const ci = workflows.get(".github/workflows/ci.yml")!;
const workflowStructure = workflows.get(".github/workflows/workflow-structure.yml")!;
const extensionAudit = readFileSync("scripts/audit-extension.sh", "utf8");
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
        ).toMatch(new RegExp(`bun-version:\\s*["']?${EXPECTED_BUN_VERSION.replaceAll(".", "\\.")}["']?(?:\\s|})`));
      });
    }

    expect(setupCount).toBeGreaterThan(0);
    expect(allWorkflows).not.toMatch(/bun-version:\s*latest\b/);
  });

  it("uses bun.lock in every workflow path and cache key", () => {
    expect(allWorkflows).not.toContain("bun.lockb");
  });

  it("keeps Vitest and its V8 coverage provider on 3.2.4", () => {
    expect(packageJson.devDependencies.vitest.replace(/^\^/, "")).toBe("3.2.4");
    expect(packageJson.devDependencies["@vitest/coverage-v8"]).toBe("3.2.4");
    expect(packageJson.scripts["test:coverage"]).toBe("vitest run --coverage");
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

  it("removes only the known incompatible broad overrides", () => {
    for (const name of ["ajv", "esbuild", "glob", "minimatch"]) {
      expect(packageJson.overrides).not.toHaveProperty(name);
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

  it("lists Playwright tests in the stable quality gate", () => {
    expect(workflowStructure).toContain(
      "bunx playwright test --list --project=chromium",
    );
  });

  it("uses the audit command supported by pinned Bun", () => {
    expect(extensionAudit).toContain("bun pm scan");
    expect(extensionAudit).not.toMatch(/bun(?: pm)? audit/);
  });

  it("represents lint, unit, coverage, build and workflow-structure gates", () => {
    expect(ci).toContain("bun run lint");
    expect(ci).toContain("bun run test");
    expect(ci).toContain("bun run test:coverage");
    expect(ci).toContain("bun run build:check");
    expect(ci).toMatch(/\bactionlint\b/);
  });
});
