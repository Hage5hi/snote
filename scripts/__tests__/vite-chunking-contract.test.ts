/** @vitest-environment node */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GetManualChunk } from "rollup";
import { loadConfigFromFile, type ConfigEnv } from "vite";
import { describe, expect, it } from "vitest";

type ResolveDependencies = (
  filename: string,
  dependencies: string[],
  context: { hostId: string; hostType: "html" | "js" },
) => string[];

const root = process.cwd();
const buildEnvironment: ConfigEnv = {
  command: "build",
  mode: "production",
  isSsrBuild: false,
  isPreview: false,
};
const manualChunkMeta = {
  *getModuleIds(): IterableIterator<string> {},
  getModuleInfo: () => null,
};

async function loadChunkingContract() {
  const loaded = await loadConfigFromFile(
    buildEnvironment,
    resolve(root, "vite.config.ts"),
  );

  if (!loaded) {
    throw new Error("Expected Vite to load vite.config.ts");
  }

  const output = loaded.config.build?.rollupOptions?.output;
  const outputOptions = Array.isArray(output) ? output[0] : output;
  const manualChunks = outputOptions?.manualChunks;
  const modulePreload = loaded.config.build?.modulePreload;

  if (typeof manualChunks !== "function") {
    throw new Error("Expected Vite manualChunks to be configured as a function");
  }
  if (
    typeof modulePreload !== "object" ||
    modulePreload === null ||
    typeof modulePreload.resolveDependencies !== "function"
  ) {
    throw new Error("Expected Vite modulePreload.resolveDependencies to be configured");
  }

  return {
    manualChunks: manualChunks as GetManualChunk,
    resolveDependencies: modulePreload.resolveDependencies as ResolveDependencies,
  };
}

describe("Vite eager vendor chunk contract", () => {
  it("routes package modules to their exact eager chunks", async () => {
    const { manualChunks, resolveDependencies } = await loadChunkingContract();

    expect(
      manualChunks(
        "C:/project/node_modules/@floating-ui/react-dom/dist/floating-ui.react-dom.mjs",
        manualChunkMeta,
      ),
    ).toBe("floating-ui-vendor");
    expect(
      manualChunks(
        "C:/project/node_modules/react-dom/cjs/react-dom-client.production.js",
        manualChunkMeta,
      ),
    ).toBe("react-vendor");
    expect(
      manualChunks(
        "C:/project/node_modules/react/cjs/react-jsx-runtime.production.js",
        manualChunkMeta,
      ),
    ).toBe("react-vendor");
    expect(
      manualChunks(
        "C:/project/node_modules/react-router/dist/index.js",
        manualChunkMeta,
      ),
    ).toBe("router-vendor");

    expect(
      resolveDependencies("assets/index-example.js", [
        "assets/router-vendor-example.js",
        "assets/floating-ui-vendor-example.js",
        "assets/mermaid-vendor-example.js",
      ], {
        hostId: "/src/main.tsx",
        hostType: "js",
      }),
    ).toEqual([
      "assets/router-vendor-example.js",
      "assets/floating-ui-vendor-example.js",
    ]);
  });

  it("keeps explicit eager vendor budgets within the initial-route budget", () => {
    const gate = readFileSync(
      resolve(root, "scripts/check-bundle-size.ts"),
      "utf8",
    );

    expect(gate).toMatch(
      /\{ prefix: "router-vendor-", label: "router-vendor", maxGz: 15_000 \}/,
    );
    expect(gate).toContain(
      '{ prefix: "floating-ui-vendor-", label: "floating-ui-vendor", maxGz: 10_000 },',
    );
    expect(gate).toContain(
      '{ prefix: "react-vendor-", label: "react-vendor", maxGz: 68_000 },',
    );
    expect(gate).toContain("const INIT_ROUTE_TOTAL_MAX_GZ = 250_000;");
  });
});
