import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Flag", () => {
  it("uses the JSX prop recognized by React 19", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/Flag.tsx"), "utf8");

    expect(source).toContain("fetchPriority={priority}");
    expect(source).not.toContain("fetchpriority={priority}");
    expect(source).not.toContain("@ts-expect-error");
  });
});
