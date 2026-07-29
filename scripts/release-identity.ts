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
