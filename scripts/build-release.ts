import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build"],
  {
    env: { ...process.env, SNOTE_REQUIRE_RELEASE_SHA: "1" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
