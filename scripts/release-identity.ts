import { execFileSync } from "node:child_process";

export type GitCommand = (args: readonly string[]) => string;

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function runGitCommand(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function resolveCleanGitHead(
  runGit: GitCommand = runGitCommand,
): string | null {
  try {
    const checkedOutSha = runGit(["rev-parse", "HEAD"]).trim();
    if (!COMMIT_SHA.test(checkedOutSha)) return null;

    const status = runGit(["status", "--porcelain", "--untracked-files=all"]);
    return status === "" ? checkedOutSha : null;
  } catch {
    return null;
  }
}

export function revalidateDeployedSha(
  initialSha: string | null,
  mode: "ordinary" | "strict",
  runGit: GitCommand = runGitCommand,
): string | null {
  const currentSha = resolveCleanGitHead(runGit);

  if (mode === "strict") {
    if (currentSha === null) {
      throw new Error(
        "Strict release Git identity could not be revalidated from a clean worktree.",
      );
    }
    if (initialSha === null || currentSha !== initialSha) {
      throw new Error("Strict release Git identity changed after configuration.");
    }
    return currentSha;
  }

  if (initialSha === null) return null;
  if (currentSha !== initialSha) {
    throw new Error("Ordinary build Git identity changed after configuration.");
  }
  return initialSha;
}
