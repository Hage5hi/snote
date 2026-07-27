import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function trackedSourceFiles(): string[] {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--",
      "*.ts",
      "*.tsx",
      "*.js",
      "*.jsx",
      "*.mjs",
      "*.cjs",
      ":(exclude)scripts/__tests__/router-v8-contract.test.ts",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => resolve(root, path));
}

describe("React Router v8 boundary", () => {
  it("uses the v8 package and no longer imports the removed DOM adapter", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines?: { node?: string };
    };

    expect(manifest.dependencies).toMatchObject({
      "lucide-react": "^0.577.0",
      "next-themes": "^0.4.6",
      react: "19.2.7",
      "react-dom": "19.2.7",
      "react-router": "8.3.0",
    });
    expect(manifest.devDependencies).toMatchObject({
      "@types/react": "^19.2.17",
      "@types/react-dom": "^19.2.3",
    });
    expect(manifest.dependencies).not.toHaveProperty("react-router-dom");

    const legacyImports = trackedSourceFiles()
      .filter((path) => readFileSync(path, "utf8").includes("react-router-dom"));

    expect(legacyImports).toEqual([]);
  });

  it("does not retain v7 future-flag props after the v8 cutover", () => {
    const filesWithFlags = trackedSourceFiles()
      .filter((path) => /v7_(?:startTransition|relativeSplatPath)/.test(readFileSync(path, "utf8")));

    expect(filesWithFlags).toEqual([]);
  });

  it("declares and verifies the minimum Node-compat runtime for Router v8", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");

    expect(manifest.engines?.node).toBe(">=22.22.0");
    expect(workflow).toContain("name: Verify Bun Node-compat floor");
    expect(workflow).toContain("process.versions.node");
    expect(workflow).toContain("major < 22 || (major === 22 && minor < 22)");
  });
});
