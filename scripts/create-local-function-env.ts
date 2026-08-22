import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (
    !isAbsolute(relation) &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`)
  );
}

export function createLocalFunctionEnv(generatedWorkdir: string): string {
  const root = realpathSync.native(resolve(generatedWorkdir));
  if (!lstatSync(root).isDirectory()) {
    throw new Error("Generated workdir must be a directory.");
  }

  const functionsRoot = realpathSync.native(join(root, "supabase", "functions"));
  if (!lstatSync(functionsRoot).isDirectory() || !isWithin(root, functionsRoot)) {
    throw new Error("Generated functions directory is invalid.");
  }

  const envPath = join(functionsRoot, ".env");
  const secret = randomBytes(32);
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(envPath, "wx", 0o600);
    created = true;
    writeFileSync(
      descriptor,
      `CAPABILITY_HMAC_SECRET=${secret.toString("hex")}\n`,
      "utf8",
    );
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(envPath, 0o600);
    return envPath;
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (created) {
      rmSync(envPath, { force: true });
    }
    throw error;
  } finally {
    secret.fill(0);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  const generatedWorkdir = process.argv[2];
  if (!generatedWorkdir) {
    console.error("Usage: bun run scripts/create-local-function-env.ts <generated-workdir>");
    process.exitCode = 1;
  } else {
    try {
      createLocalFunctionEnv(generatedWorkdir);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to create local function env.");
      process.exitCode = 1;
    }
  }
}
