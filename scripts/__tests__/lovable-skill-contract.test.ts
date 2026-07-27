import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skillPath = "lovable-skills/snote-release/SKILL.md";

describe("Lovable workspace skill source", () => {
  it("ships one import-ready, narrowly scoped Snote release skill", () => {
    const skill = readFileSync(skillPath, "utf8");

    expect(skill).toMatch(/^---\r?\nname: snote-release\r?\n/);
    expect(skill).toMatch(
      /^description: Use when reviewing Snote for release, deployment, rollback, or production readiness\./m,
    );
    expect(skill).toContain("Never reopen direct public table access");
    expect(skill).toContain("Never log note content, slug, capability, token, or raw IP");
    expect(skill).toContain("No-go");
    expect(skill.split(/\r?\n/).length).toBeLessThan(80);
  });
});
