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
const ALL_MIGRATIONS = [
  "20260302004416_1f426076-1b70-40b2-b64d-2469de8d3877.sql",
  "20260302005759_1d85738f-bd48-437f-8bee-ec57341c295e.sql",
  "20260302011021_fa7cadc9-65e5-495e-b9b1-da66eaee8d7b.sql",
  "20260302022256_f0c1c807-948c-4301-a4ae-07787722a937.sql",
  "20260302154947_ea0fdfed-0614-4a13-ab36-ad69927bd225.sql",
  "20260320210302_a87bc0ac-5ce1-42c8-ae5c-b284e6d185a7.sql",
  "20260320210849_9a7c7fe3-890a-46f3-b836-c0f003a84c0b.sql",
  "20260419225907_132b81c1-92f7-4aab-bd60-7136679e518c.sql",
  "20260419235758_85c29c59-c1af-460b-a986-b6706ea3019e.sql",
  "20260420010539_f771c643-6963-4ddb-9212-939649771d8a.sql",
  "20260420041258_01f4e8f4-7ae1-49f4-a144-14f107a60c09.sql",
  "20260420180403_68c28749-9453-4a4e-a68b-e774eb1bad2c.sql",
  "20260422132016_efe5dfa3-9e43-4e1c-adda-7496f4193a96.sql",
  "20260425000000_drop_leftover_buckets.sql",
  "20260425001208_6b7763c4-4e86-4ee7-ba9e-239b1c853e41.sql",
  "20260427041711_828a9986-2e8b-4be4-8149-2cbdcf2e1361.sql",
  "20260427041811_c85199ea-e258-4488-8a2a-f3bc1e707660.sql",
  "20260522000000_admin_rate_limit.sql",
  "20260719000000_security_immediate_containment.sql",
  "20260722000000_capability_backend.sql",
  "20260723000000_capability_checkpoint_compaction.sql",
  ATOMIC_CUTOVER,
  "20260727000000_capability_sync_conflict_codes.sql",
] as const;
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
      schemaVersion: number;
      sourceCommit: string;
      excludedMigration: string;
      migrations: Array<{ file: string; sha256: string }>;
    };
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      sourceCommit: "0123456789abcdef",
      excludedMigration: ATOMIC_CUTOVER,
    });
    expect(manifest.migrations).toEqual(
      SELECTED_MIGRATIONS.map((file) => ({
        file,
        sha256: sha256(resolve(fixture.repoRoot, "supabase/migrations", file)),
      })),
    );
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
