/** @vitest-environment node */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, loadConfigFromFile, type ConfigEnv } from "vite";
import { describe, expect, it } from "vitest";

const CONFIG_ENV: ConfigEnv = {
  command: "build",
  mode: "production",
  isSsrBuild: false,
  isPreview: false,
};
const ENV_KEYS = [
  "VITE_CAPABILITY_ROUTES_ENABLED",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
] as const;

async function withEnv(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function loadConfig() {
  return loadConfigFromFile(CONFIG_ENV, resolve(process.cwd(), "vite.config.ts"));
}

describe("staging build isolation", () => {
  it("keeps the local capability HMAC secret ephemeral and off output", () => {
    const plan = readFileSync(
      resolve(process.cwd(), "docs/security/staging-plan-2026-08.md"),
      "utf8",
    );

    expect(plan).toContain("RandomNumberGenerator]::GetBytes(32)");
    expect(plan).toContain("start --env-file $SecretFilePath");
    expect(plan).toMatch(/finally\s*\{[\s\S]*Remove-Item -LiteralPath \$SecretFilePath/);
    expect(plan).not.toMatch(/(?:Write-(?:Host|Output)|echo).*CapabilityHmacSecret/i);
  });

  it("rejects capability routes when Supabase values would fall back to .env", async () => {
    await withEnv({ VITE_CAPABILITY_ROUTES_ENABLED: "true" }, async () => {
      await expect(loadConfig()).rejects.toThrow(/complete staging Supabase environment/i);
    });
  });

  it("accepts an explicitly configured local Supabase backend", async () => {
    await withEnv({
      VITE_CAPABILITY_ROUTES_ENABLED: "true",
      VITE_SUPABASE_PROJECT_ID: "snote-staging-local",
      VITE_SUPABASE_PUBLISHABLE_KEY: "local-publishable-placeholder",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
    }, async () => {
      await expect(loadConfig()).resolves.not.toBeNull();
    });
  });

  it.each([
    "VITE_SUPABASE_PROJECT_ID",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
  ] as const)("rejects capability routes when %s is not explicit", async (missingKey) => {
    const explicitEnv: Record<(typeof ENV_KEYS)[number], string> = {
      VITE_CAPABILITY_ROUTES_ENABLED: "true",
      VITE_SUPABASE_PROJECT_ID: "snote-staging-local",
      VITE_SUPABASE_PUBLISHABLE_KEY: "local-publishable-placeholder",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
    };
    delete explicitEnv[missingKey];

    await withEnv(explicitEnv, async () => {
      await expect(loadConfig()).rejects.toThrow(/complete staging Supabase environment/i);
    });
  });

  it("writes a staging CSP without the production backend", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "snote-staging-build-"));
    try {
      await withEnv({
        VITE_CAPABILITY_ROUTES_ENABLED: "true",
        VITE_SUPABASE_PROJECT_ID: "snote-staging-local",
        VITE_SUPABASE_PUBLISHABLE_KEY: "local-publishable-placeholder",
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      }, async () => {
        await build({
          configFile: resolve(process.cwd(), "vite.config.ts"),
          mode: "production",
          logLevel: "silent",
          build: { outDir, emptyOutDir: true },
        });
      });

      const headers = readFileSync(resolve(outDir, "_headers"), "utf8");
      expect(headers).not.toContain("onfzjmfjldsbthchssfr");
      expect(headers).toContain("http://127.0.0.1:54321");
      expect(headers).toContain("ws://127.0.0.1:54321");
      const productionRef = Buffer.from("onfzjmfjldsbthchssfr");
      const leakedArtifact = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .find((entry) => readFileSync(resolve(entry.parentPath, entry.name)).includes(productionRef));
      expect(leakedArtifact).toBeUndefined();
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    ["project id", "ONFZJMFJLDSBTHCHSSFR", "http://127.0.0.1:54321"],
    ["URL", "snote-staging-local", "https://ONFZJMFJLDSBTHCHSSFR.SUPABASE.CO."],
  ])("rejects the production Supabase reference in the explicit %s", async (_label, projectId, url) => {
    await withEnv({
      VITE_CAPABILITY_ROUTES_ENABLED: "true",
      VITE_SUPABASE_PROJECT_ID: projectId,
      VITE_SUPABASE_PUBLISHABLE_KEY: "staging-publishable-placeholder",
      VITE_SUPABASE_URL: url,
    }, async () => {
      await expect(loadConfig()).rejects.toThrow(/production Supabase project/i);
    });
  });
});
