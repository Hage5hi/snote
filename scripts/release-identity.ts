import { execFileSync } from "node:child_process";

export type GitCommand = (args: readonly string[]) => string;

export type ReleaseEnvironment = {
  SNOTE_REQUIRE_RELEASE_SHA?: string;
  SNOTE_RELEASE_SHA?: string;
};

export type ReleaseIdentity = {
  strict: boolean;
  deployedSha: string | null;
};

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function runGit(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveCleanHead(git: GitCommand): string | null {
  try {
    const headBeforeStatus = git(["rev-parse", "HEAD"]).trim();
    const status = git(["status", "--porcelain", "--untracked-files=all"]);
    const headAfterStatus = git(["rev-parse", "HEAD"]).trim();

    return status === ""
      && COMMIT_SHA.test(headBeforeStatus)
      && COMMIT_SHA.test(headAfterStatus)
      && headBeforeStatus === headAfterStatus
      ? headBeforeStatus
      : null;
  } catch {
    return null;
  }
}

export function resolveReleaseIdentity(
  env: ReleaseEnvironment = process.env,
  git: GitCommand = runGit,
): ReleaseIdentity {
  const required = env.SNOTE_REQUIRE_RELEASE_SHA;
  const requested = env.SNOTE_RELEASE_SHA;

  if (required === undefined && requested === undefined) {
    return { strict: false, deployedSha: null };
  }
  if (required !== "1") {
    if (required === undefined && requested !== undefined) {
      throw new Error("SNOTE_RELEASE_SHA is only accepted by a strict release build.");
    }
    throw new Error('SNOTE_REQUIRE_RELEASE_SHA must be omitted or exactly "1".');
  }
  if (!requested) {
    throw new Error("SNOTE_REQUIRE_RELEASE_SHA=1 requires SNOTE_RELEASE_SHA.");
  }
  if (!COMMIT_SHA.test(requested)) {
    throw new Error("SNOTE_RELEASE_SHA must be an exact 40-character lowercase commit SHA.");
  }

  const head = resolveCleanHead(git);
  if (head === null) {
    throw new Error("A strict release build requires a clean Git checkout.");
  }
  if (head !== requested) {
    throw new Error("SNOTE_RELEASE_SHA does not match checked-out HEAD.");
  }

  return { strict: true, deployedSha: head };
}

export function revalidateReleaseIdentity(
  identity: ReleaseIdentity,
  git: GitCommand = runGit,
): string | null {
  if (!identity.strict) return null;

  const head = resolveCleanHead(git);
  if (head === null || head !== identity.deployedSha) {
    throw new Error("Strict release identity changed during the build.");
  }

  return head;
}
