import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LAZY_LANGS = ["vi", "zh", "ja", "ko", "fr", "es", "de", "pt"] as const;

function runtimeSources(path: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || child === "src/i18n/locales") continue;
      files.push(...runtimeSources(child));
      continue;
    }
    if (!/\.[jt]sx?$/.test(entry.name) || /\.test\.[jt]sx?$/.test(entry.name)) continue;
    if (child === "src/i18n/catalog.ts" || child === "src/i18n/loaders.ts") continue;
    files.push(child);
  }
  return files;
}

describe("lazy locale contract", () => {
  it("keeps English eager and loads every other locale through dynamic imports", () => {
    expect(existsSync("src/i18n/loaders.ts")).toBe(true);
    const loaders = readFileSync("src/i18n/loaders.ts", "utf8");

    expect(loaders).toContain('import en from "./locales/en"');
    for (const lang of LAZY_LANGS) {
      expect(existsSync(`src/i18n/locales/${lang}.ts`), lang).toBe(true);
      expect(loaders, lang).toContain(`import("./locales/${lang}")`);
      expect(loaders, lang).not.toMatch(
        new RegExp(`^import .*["']\\./locales/${lang}["']`, "m"),
      );
    }
  });

  it("keeps the static all-locale catalog out of runtime modules", () => {
    const runtime = runtimeSources("src")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(existsSync("src/i18n/catalog.ts")).toBe(true);
    expect(runtime).not.toContain('from "./catalog"');
    expect(runtime).not.toContain('from "@/i18n/catalog"');
    for (const lang of LAZY_LANGS) {
      expect(runtime, lang).not.toContain(`/locales/${lang}`);
    }
    expect(runtime).not.toMatch(/\bexport const dict\b/);
  });
});
