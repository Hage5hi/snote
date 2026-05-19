import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAllowlistCheck, type RunReport } from "../i18n-allowlist-check";

// Reuse the real schema so we test against the source of truth.
const REAL_SCHEMA = JSON.parse(
  readFileSync(join(process.cwd(), ".lintrc-i18n-allowlist.schema.json"), "utf8"),
);

function makeRoot(): string {
  const root = join(tmpdir(), `allowlist-test-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(join(root, "src/pages"), { recursive: true });
  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(join(root, ".lintrc-i18n-allowlist.schema.json"), JSON.stringify(REAL_SCHEMA));
  return root;
}

function writeAllowlist(root: string, body: unknown): void {
  writeFileSync(join(root, ".lintrc-i18n-allowlist.json"), JSON.stringify(body));
}

function writeSrc(root: string, rel: string, contents: string): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, contents);
}

function run(root: string): RunReport {
  return runAllowlistCheck({ root, silent: true });
}

describe("i18n-allowlist-check schema validation", () => {
  let root: string;
  beforeEach(() => {
    root = makeRoot();
  });

  it("passes on a well-formed allowlist with matching source", () => {
    writeAllowlist(root, {
      entries: [{ file: "src/pages/Ok.tsx", reason: "brand label" }],
    });
    writeSrc(
      root,
      "src/pages/Ok.tsx",
      `// eslint-disable-next-line no-restricted-syntax -- brand label\nexport const x = 1;\n`,
    );
    const r = run(root);
    expect(r.ok).toBe(true);
    expect(r.schemaOk).toBe(true);
    expect(r.driftOk).toBe(true);
    expect(r.totals.entries).toBe(1);
    expect(r.entries[0].matchedInSource).toBe(true);
    expect(r.entries[0].matchedSites[0]).toMatchObject({ line: 1 });
  });

  it("reports missing required field grouped by entries[i]", () => {
    writeAllowlist(root, { entries: [{ file: "src/pages/A.tsx" }] });
    writeSrc(root, "src/pages/A.tsx", "// noop\n");
    const r = run(root);
    expect(r.ok).toBe(false);
    expect(r.schemaOk).toBe(false);
    const g = r.groupedSchemaErrors.find((g) => g.group === "entries[0]");
    expect(g).toBeDefined();
    expect(g!.messages.some((m) => m.includes(`"reason"`))).toBe(true);
    expect(g!.messages.some((m) => m.includes("file, reason, notes"))).toBe(true);
  });

  it("suggests the closest expected key for typos in entries[i]", () => {
    writeAllowlist(root, {
      entries: [{ file: "src/pages/A.tsx", reason: "x", resaon: "typo" }],
    });
    writeSrc(root, "src/pages/A.tsx", "// noop\n");
    const r = run(root);
    expect(r.schemaOk).toBe(false);
    const g = r.groupedSchemaErrors.find((g) => g.group === "entries[0]")!;
    const msg = g.messages.find((m) => m.includes(`"resaon"`));
    expect(msg).toBeDefined();
    expect(msg!).toContain(`did you mean "reason"`);
  });

  it("rejects file paths outside src/ via pattern", () => {
    writeAllowlist(root, {
      entries: [{ file: "scripts/foo.ts", reason: "x" }],
    });
    const r = run(root);
    expect(r.schemaOk).toBe(false);
    const g = r.groupedSchemaErrors.find((g) => g.group === "entries[0]")!;
    expect(g.messages.some((m) => m.includes("does not match required pattern"))).toBe(true);
  });

  it("rejects empty reason strings (minLength)", () => {
    writeAllowlist(root, {
      entries: [{ file: "src/pages/A.tsx", reason: "" }],
    });
    writeSrc(root, "src/pages/A.tsx", "// noop\n");
    const r = run(root);
    expect(r.schemaOk).toBe(false);
    const g = r.groupedSchemaErrors.find((g) => g.group === "entries[0]")!;
    expect(g.messages.some((m) => m.includes("non-empty string"))).toBe(true);
  });

  it("reports root-level errors under (root) group", () => {
    writeAllowlist(root, { wrong: [] });
    const r = run(root);
    expect(r.schemaOk).toBe(false);
    const g = r.groupedSchemaErrors.find((g) => g.group === "(root)");
    expect(g).toBeDefined();
  });

  it("detects drift: unallowlisted disable in source", () => {
    writeAllowlist(root, { entries: [] });
    writeSrc(
      root,
      "src/pages/A.tsx",
      `// eslint-disable-next-line no-restricted-syntax -- new reason\nexport const x = 1;\n`,
    );
    const r = run(root);
    expect(r.ok).toBe(false);
    expect(r.driftOk).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].reason).toBe("new reason");
  });

  it("detects stale allowlist entry without source match", () => {
    writeAllowlist(root, {
      entries: [{ file: "src/pages/A.tsx", reason: "ghost" }],
    });
    writeSrc(root, "src/pages/A.tsx", "// noop\n");
    const r = run(root);
    expect(r.driftOk).toBe(false);
    expect(r.stale).toContain("src/pages/A.tsx::ghost");
    expect(r.entries[0].errors).toContain("no matching eslint-disable comment in source (stale)");
  });

  it("always writes both report files", () => {
    writeAllowlist(root, { entries: [{ file: "src/pages/A.tsx", reason: "r" }] });
    writeSrc(
      root,
      "src/pages/A.tsx",
      `// eslint-disable-next-line no-restricted-syntax -- r\n`,
    );
    run(root);
    expect(existsSync(join(root, "reports/i18n-allowlist-report.json"))).toBe(true);
    expect(existsSync(join(root, "reports/i18n-allowlist-report.md"))).toBe(true);
    const md = readFileSync(join(root, "reports/i18n-allowlist-report.md"), "utf8");
    expect(md).toContain("# i18n Allowlist Validation Report");
    expect(md).toContain("✅ PASS");
  });

  it("writes a failure report when schema is invalid", () => {
    writeAllowlist(root, { entries: [{ file: "src/pages/A.tsx" }] });
    run(root);
    const json = JSON.parse(
      readFileSync(join(root, "reports/i18n-allowlist-report.json"), "utf8"),
    );
    expect(json.ok).toBe(false);
    expect(json.schemaOk).toBe(false);
    expect(json.groupedSchemaErrors[0].group).toBe("entries[0]");
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// vitest auto-imports — but ensure afterEach is in scope.
import { afterEach } from "vitest";
