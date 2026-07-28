import { spawnSync } from "node:child_process";

// This is the only supported release-build entry point. A release artifact
// cannot claim the checked-out commit if tracked or untracked source differs
// from it. The Vite config separately binds the supplied SHA to HEAD.
const worktree = spawnSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

if (worktree.error || worktree.status !== 0) {
  throw new Error("build:release requires a clean Git worktree with Git metadata.");
}
if (worktree.stdout.trim()) {
  throw new Error("build:release requires a clean Git worktree.");
}

const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build"],
  {
    env: {
      ...process.env,
      SNOTE_REQUIRE_RELEASE_SHA: "1",
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
