import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("I18nProvider privacy", () => {
  it("uses browser language without making an IP geolocation request", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./provider.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain("ipapi.co");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
