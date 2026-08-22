/** @vitest-environment node */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  symlinkSync,
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
  sourceCommit: string;
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
  writeFileSync(
    resolve(repoRoot, ".gitignore"),
    "supabase/functions/.env\n",
    "utf8",
  );
  for (const file of ALL_MIGRATIONS) {
    writeFileSync(resolve(migrationRoot, file), `-- ${file}\n`, "utf8");
  }
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  commitFixture(repoRoot, "fixture");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  return { repoRoot, tempParent, sourceCommit };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(root, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    )
    .sort();
}

function commitFixture(repoRoot: string, message: string, stage = true): void {
  if (stage) {
    execFileSync("git", ["add", "-A"], { cwd: repoRoot, stdio: "ignore" });
  }
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Snote test",
      "-c",
      "user.email=snote-test@example.invalid",
      "commit",
      "-m",
      message,
    ],
    { cwd: repoRoot, stdio: "ignore" },
  );
}

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) cleanup(root);
});

describe("prepareStagingWorkdir", () => {
  it("copies only additive migrations into a local-only hashed workdir", () => {
    const fixture = createFixture();
    const result = prepareStagingWorkdir(fixture);
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
      files: Array<{ file: string; sha256: string }>;
    };
    expect(manifest).toEqual({
      sourceCommit: fixture.sourceCommit,
      files: listFiles(generatedSupabase).map((file) => ({
        file: `supabase/${file}`,
        sha256: sha256(resolve(generatedSupabase, file)),
      })),
    });
  });

  it("fails before returning output when an allowlisted migration is missing", () => {
    const fixture = createFixture();
    rmSync(
      resolve(fixture.repoRoot, "supabase/migrations", SELECTED_MIGRATIONS[0]),
    );
    commitFixture(fixture.repoRoot, "remove migration");

    expect(() => prepareStagingWorkdir(fixture))
      .toThrow(/missing/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects ambient Supabase project linkage before creating output", () => {
    const fixture = createFixture();
    const linkPath = resolve(fixture.repoRoot, "supabase/.temp/project-ref");
    mkdirSync(resolve(linkPath, ".."), { recursive: true });
    writeFileSync(linkPath, "remote-project-ref", "utf8");

    expect(() => prepareStagingWorkdir(fixture))
      .toThrow(/link/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects a source config without one project id assignment", () => {
    const fixture = createFixture();
    writeFileSync(resolve(fixture.repoRoot, "supabase/config.toml"), "api_port = 54321\n");
    commitFixture(fixture.repoRoot, "invalidate config");

    expect(() => prepareStagingWorkdir(fixture))
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
    })).toThrow(/outside/i);
  });

  it.each([
    ["modified tracked function", "note-session/index.ts"],
    ["untracked function", "untracked.ts"],
    ["ignored function environment", ".env"],
  ])("rejects a %s before creating output", (_label, relativePath) => {
    const fixture = createFixture();
    writeFileSync(
      resolve(fixture.repoRoot, "supabase/functions", relativePath),
      "ambient-secret-or-code\n",
      "utf8",
    );

    expect(() => prepareStagingWorkdir(fixture)).toThrow(/clean/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects a tracked function change hidden by assume-unchanged", () => {
    const fixture = createFixture();
    const functionPath = "supabase/functions/note-session/index.ts";
    execFileSync("git", ["update-index", "--assume-unchanged", functionPath], {
      cwd: fixture.repoRoot,
      stdio: "ignore",
    });
    writeFileSync(resolve(fixture.repoRoot, functionPath), "ambient-change\n", "utf8");

    expect(() => prepareStagingWorkdir(fixture)).toThrow(/clean/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects a committed Edge Function environment file", () => {
    const fixture = createFixture();
    const environmentPath = resolve(fixture.repoRoot, "supabase/functions/.env");
    writeFileSync(environmentPath, "STAGING_SECRET=must-not-copy\n", "utf8");
    execFileSync("git", ["add", "-f", "supabase/functions/.env"], {
      cwd: fixture.repoRoot,
      stdio: "ignore",
    });
    commitFixture(fixture.repoRoot, "track forbidden environment");

    expect(() => prepareStagingWorkdir(fixture)).toThrow(/environment file/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects a committed symlink even when Git materializes it as a file", () => {
    const fixture = createFixture();
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: fixture.repoRoot,
      encoding: "utf8",
      input: "../outside-function",
    }).trim();
    execFileSync(
      "git",
      [
        "update-index",
        "--add",
        "--cacheinfo",
        `120000,${blob},supabase/functions/linked-function`,
      ],
      { cwd: fixture.repoRoot, stdio: "ignore" },
    );
    commitFixture(fixture.repoRoot, "track forbidden symlink", false);
    execFileSync(
      "git",
      ["checkout-index", "--force", "--", "supabase/functions/linked-function"],
      { cwd: fixture.repoRoot, stdio: "ignore" },
    );

    expect(() => prepareStagingWorkdir(fixture)).toThrow(/tracked regular files/i);
    expect(readdirSync(fixture.tempParent)).toEqual([]);
  });

  it("rejects an output-parent junction that resolves inside the checkout", () => {
    const fixture = createFixture();
    const linkRoot = mkdtempSync(join(tmpdir(), "snote-g3a-link-"));
    cleanupRoots.unshift(linkRoot);
    const insideOutput = resolve(fixture.repoRoot, "generated");
    mkdirSync(insideOutput);
    const alias = resolve(linkRoot, "outside-looking-alias");
    symlinkSync(
      insideOutput,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() => prepareStagingWorkdir({
      repoRoot: fixture.repoRoot,
      tempParent: alias,
    })).toThrow(/outside/i);
    expect(readdirSync(insideOutput)).toEqual([]);
  });
});
