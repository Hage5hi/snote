/** @vitest-environment node */

import { createHash } from "node:crypto";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { prepareStagingWorkdir } from "../prepare-staging-workdir";

const ATOMIC_CUTOVER = "20260724000000_atomic_capability_cutover.sql";
const ALL_MIGRATIONS = readdirSync(resolve(process.cwd(), "supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const SELECTED_MIGRATIONS = ALL_MIGRATIONS.filter((file) => file !== ATOMIC_CUTOVER);
const cleanupRoots: string[] = [];

type Fixture = Readonly<{
  repoRoot: string;
  tempParent: string;
}>;

function cleanup(root: string): void {
  const canonicalTemp = resolve(tmpdir());
  const candidate = resolve(root);
  const relation = relative(canonicalTemp, candidate);
  if (!relation || relation.startsWith("..")) {
    throw new Error(`Refusing to clean non-temporary fixture: ${candidate}`);
  }
  rmSync(candidate, { recursive: true, force: true });
}

function createFixture(): Fixture {
  const repoRoot = mkdtempSync(join(tmpdir(), "snote-g3a-source-"));
  const tempParent = mkdtempSync(join(tmpdir(), "snote-g3a-output-"));
  cleanupRoots.push(repoRoot, tempParent);

  const supabaseRoot = resolve(repoRoot, "supabase");
  const migrationRoot = resolve(supabaseRoot, "migrations");
  const functionRoot = resolve(supabaseRoot, "functions", "note-session");
  mkdirSync(migrationRoot, { recursive: true });
  mkdirSync(functionRoot, { recursive: true });
  writeFileSync(
    resolve(supabaseRoot, "config.toml"),
    'project_id = "onfzjmfjldsbthchssfr"\n\n[functions.note-session]\nverify_jwt = false\n',
    "utf8",
  );
  writeFileSync(resolve(functionRoot, "index.ts"), "export {};\n", "utf8");
  for (const file of ALL_MIGRATIONS) {
    writeFileSync(resolve(migrationRoot, file), `-- ${file}\n`, "utf8");
  }
  return { repoRoot, tempParent };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) cleanup(root);
});

describe("prepareStagingWorkdir", () => {
  it("copies only additive migrations into a local-only hashed workdir", () => {
    const fixture = createFixture();
    const result = prepareStagingWorkdir({
      ...fixture,
      sourceCommit: "0123456789abcdef",
    });
    const generatedSupabase = resolve(result.workdir, "supabase");
    const generatedMigrations = resolve(generatedSupabase, "migrations");

    expect(ALL_MIGRATIONS).toContain(ATOMIC_CUTOVER);
    expect(relative(fixture.repoRoot, result.workdir)).toMatch(/^\.\./);
    expect(readdirSync(generatedMigrations).sort()).toEqual(SELECTED_MIGRATIONS);
    expect(readdirSync(generatedMigrations)).not.toContain(ATOMIC_CUTOVER);
    expect(readFileSync(resolve(generatedSupabase, "config.toml"), "utf8"))
      .toContain('project_id = "snote-staging-local"');
    expect(readFileSync(resolve(generatedSupabase, "config.toml"), "utf8"))
      .not.toContain("onfzjmfjldsbthchssfr");
    expect(readFileSync(resolve(generatedSupabase, "functions/note-session/index.ts"), "utf8"))
      .toBe("export {};\n");

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      sourceCommit: string;
      migrations: Array<{ file: string; sha256: string }>;
    };
    expect(manifest).toEqual({
      sourceCommit: "0123456789abcdef",
      migrations: SELECTED_MIGRATIONS.map((file) => ({
        file,
        sha256: sha256(resolve(fixture.repoRoot, "supabase/migrations", file)),
      })),
    });
  });

  it("fails before returning output when an allowlisted migration is missing", () => {
    const fixture = createFixture();
    rmSync(
      resolve(fixture.repoRoot, "supabase/migrations", SELECTED_MIGRATIONS[0]),
    );

    expect(() => prepareStagingWorkdir({ ...fixture, sourceCommit: "abc" }))
      .toThrow(/missing/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects ambient Supabase project linkage before creating output", () => {
    const fixture = createFixture();
    const linkPath = resolve(fixture.repoRoot, "supabase/.temp/project-ref");
    mkdirSync(resolve(linkPath, ".."), { recursive: true });
    writeFileSync(linkPath, "remote-project-ref", "utf8");

    expect(() => prepareStagingWorkdir({ ...fixture, sourceCommit: "abc" }))
      .toThrow(/link/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects a source config without one project id assignment", () => {
    const fixture = createFixture();
    writeFileSync(resolve(fixture.repoRoot, "supabase/config.toml"), "api_port = 54321\n");

    expect(() => prepareStagingWorkdir({ ...fixture, sourceCommit: "abc" }))
      .toThrow(/project_id/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects an output parent inside the source checkout", () => {
    const fixture = createFixture();
    const nestedOutput = resolve(fixture.repoRoot, "generated");
    mkdirSync(nestedOutput);

    expect(() => prepareStagingWorkdir({
      repoRoot: fixture.repoRoot,
      tempParent: nestedOutput,
      sourceCommit: "abc",
    })).toThrow(/outside/i);
  });
});
