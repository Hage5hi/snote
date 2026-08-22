import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const PRODUCTION_PROJECT_REF = "onfzjmfjldsbthchssfr";
const LOCAL_PROJECT_ID = "snote-staging-local";
const ATOMIC_CUTOVER = "20260724000000_atomic_capability_cutover.sql";
const APPROVED_MIGRATIONS = [
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
  "20260727000000_capability_sync_conflict_codes.sql",
] as const;

export type PrepareStagingWorkdirOptions = Readonly<{
  repoRoot?: string;
  tempParent?: string;
  sourceCommit?: string;
}>;

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(resolve(parent), resolve(candidate));
  return relation === "" || (
    !isAbsolute(relation) &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`)
  );
}

function assertRegularFile(path: string, label: string): void {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Missing or invalid ${label}: ${path}`);
  }
}

function assertDirectory(path: string, label: string): void {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`Missing or invalid ${label}: ${path}`);
  }
}

function readSourceCommit(repoRoot: string, supplied?: string): string {
  const commit = supplied?.trim() || execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!commit) throw new Error("Unable to determine the staging source commit.");
  return commit;
}

function rewriteConfig(source: string): string {
  const projectAssignments = source.match(/^project_id\s*=\s*"[^"\r\n]*"\s*$/gm) ?? [];
  if (projectAssignments.length !== 1) {
    throw new Error("Supabase config must contain exactly one project_id assignment.");
  }
  const rewritten = source.replace(
    /^project_id\s*=\s*"[^"\r\n]*"\s*$/m,
    `project_id = "${LOCAL_PROJECT_ID}"`,
  );
  if (rewritten.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error("Generated Supabase config retained the production project reference.");
  }
  return rewritten;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function prepareStagingWorkdir(
  options: PrepareStagingWorkdirOptions = {},
): { workdir: string; manifestPath: string } {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const tempParent = resolve(options.tempParent ?? tmpdir());
  const supabaseRoot = resolve(repoRoot, "supabase");
  const configPath = resolve(supabaseRoot, "config.toml");
  const functionsPath = resolve(supabaseRoot, "functions");
  const migrationsPath = resolve(supabaseRoot, "migrations");

  if (isWithin(repoRoot, tempParent)) {
    throw new Error("Staging output parent must be outside the source checkout.");
  }
  assertDirectory(tempParent, "temporary output parent");
  if (
    existsSync(resolve(supabaseRoot, ".temp/project-ref")) ||
    existsSync(resolve(supabaseRoot, ".branches"))
  ) {
    throw new Error("Refusing to prepare staging from a linked Supabase source tree.");
  }
  assertRegularFile(configPath, "Supabase config");
  assertDirectory(functionsPath, "Edge Functions directory");
  assertDirectory(migrationsPath, "migration directory");

  const approvedMigrationNames = new Set<string>(APPROVED_MIGRATIONS);
  if (
    approvedMigrationNames.size !== APPROVED_MIGRATIONS.length ||
    approvedMigrationNames.has(ATOMIC_CUTOVER)
  ) {
    throw new Error("Invalid staging migration allowlist.");
  }
  const expectedSourceMigrations = [...APPROVED_MIGRATIONS, ATOMIC_CUTOVER].sort();
  const sourceEntries = readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".sql"));
  if (sourceEntries.some((entry) => !entry.isFile())) {
    throw new Error("Missing or invalid source migration file.");
  }
  const sourceMigrations = sourceEntries
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(sourceMigrations) !== JSON.stringify(expectedSourceMigrations)) {
    throw new Error("Missing or unexpected source migration for the staging selection.");
  }

  const sourceCommit = readSourceCommit(repoRoot, options.sourceCommit);
  const rewrittenConfig = rewriteConfig(readFileSync(configPath, "utf8"));
  let createdRoot: string | undefined;
  try {
    createdRoot = mkdtempSync(join(tempParent, "snote-g3a-"));
    const generatedSupabase = resolve(createdRoot, "supabase");
    const generatedMigrations = resolve(generatedSupabase, "migrations");
    mkdirSync(generatedMigrations, { recursive: true });
    writeFileSync(resolve(generatedSupabase, "config.toml"), rewrittenConfig, "utf8");
    cpSync(functionsPath, resolve(generatedSupabase, "functions"), { recursive: true });

    const migrations = APPROVED_MIGRATIONS.map((file) => {
      const sourcePath = resolve(migrationsPath, file);
      cpSync(sourcePath, resolve(generatedMigrations, file));
      return { file, sha256: hashFile(sourcePath) };
    });
    const manifest = {
      sourceCommit,
      migrations,
    };
    const manifestPath = resolve(createdRoot, "staging-manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { workdir: createdRoot, manifestPath };
  } catch (error) {
    if (createdRoot) rmSync(createdRoot, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.main) {
  const result = prepareStagingWorkdir();
  console.log(`Staging workdir: ${result.workdir}`);
  console.log(`Manifest: ${result.manifestPath}`);
}
