/** @vitest-environment node */

import { resolve } from "node:path";
import { loadConfigFromFile, type ConfigEnv } from "vite";
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
  it("rejects capability routes when Supabase values would fall back to .env", async () => {
    await withEnv({ VITE_CAPABILITY_ROUTES_ENABLED: "true" }, async () => {
      await expect(loadConfig()).rejects.toThrow(/production Supabase project/i);
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
