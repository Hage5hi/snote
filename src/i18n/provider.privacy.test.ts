import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("I18nProvider privacy", () => {
  it("uses browser language without making an IP geolocation request", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/i18n/provider.tsx"),
      "utf8",
    );

    expect(source).not.toContain("ipapi.co");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
