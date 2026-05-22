#!/usr/bin/env bun
// Update screenshot baselines ONLY for scenes whose source changed in the
// current diff. Avoids the "I touched one shader, regenerate 60 baselines"
// problem.
//
// Usage:
//   bun run scripts/e2e-update-changed-scenes.ts              # vs merge-base origin/main
//   bun run scripts/e2e-update-changed-scenes.ts --base HEAD~1
//   bun run scripts/e2e-update-changed-scenes.ts --scenes neon-vapor,terminal-boot
//   PIXEL_DIFF_RATIO=0.04 bun run scripts/e2e-update-changed-scenes.ts
//
// Strategy:
//   1. Resolve git diff (base..HEAD) for src/components/home/scenes/**.
//   2. Map each touched file to its registry id via a regex over registry.ts.
//   3. If --scenes is passed, use that list instead of the diff.
//   4. Invoke `playwright test --update-snapshots -g "scene\[<id>\]"`
//      with the merged scene set. No scenes? Exit 0 (nothing to do).
//   bun run scripts/e2e-update-changed-scenes.ts --scene-diff neon-vapor=0.05
//   PIXEL_DIFF_RATIO=0.04 bun run scripts/e2e-update-changed-scenes.ts
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSceneDiffFlags,
  loadKnownSceneIds,
  writeSceneDiffExpansionsLog,
  SCENE_DIFF_HELP,
} from "./_helpers/scene-diff-args";

const args = process.argv.slice(2);
function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun run scripts/e2e-update-changed-scenes.ts [options]

Updates Playwright screenshot baselines only for scenes whose source files
changed in the current diff (or the explicit --scenes list).

Options:
  --base <ref>            Git ref to diff against (default: merge-base origin/main).
  --scenes a,b,c          Update only these scene ids (skips the diff).

${SCENE_DIFF_HELP}
`);
  process.exit(0);
}

const base = flag("--base") ?? safeMergeBase("origin/main");
const explicit = flag("--scenes");
const knownIds = loadKnownSceneIds();
const {
  env: childEnv,
  overrides: sceneDiffOverrides,
  chromeDiff: chromeDiffOverride,
  unknown: unknownSceneFlags,
  expansions: sceneDiffExpansions,
} = parseSceneDiffFlags(args, { knownSceneIds: knownIds });

const expansionsLog =
  process.env.SCENE_DIFF_EXPANSIONS_LOG ??
  "test-results/scene-diff-expansions.json";
writeSceneDiffExpansionsLog(sceneDiffExpansions, expansionsLog);

function safeMergeBase(ref: string): string {
  try {
    return execSync(`git merge-base HEAD ${ref}`, { encoding: "utf8" }).trim();
  } catch {
    return "HEAD~1";
  }
}

// 1. Parse registry → { sourcePath → id }.
const registryPath = resolve("src/components/home/scenes/registry.ts");
const registry = readFileSync(registryPath, "utf8");
const fileToId = new Map<string, string>();
// Matches: id: "neon-vapor", ... load: () => import("./NeonVapor"),
const blocks = registry.split(/\{\s*\n/).slice(1);
for (const block of blocks) {
  const idMatch = block.match(/id:\s*["']([^"']+)["']/);
  const loadMatch = block.match(/import\(\s*["']\.\/([^"']+)["']/);
  if (!idMatch || !loadMatch) continue;
  const file = `src/components/home/scenes/${loadMatch[1]}.tsx`;
  fileToId.set(file, idMatch[1]);
}

let sceneIds: string[];
if (explicit) {
  sceneIds = explicit.split(",").map((s) => s.trim()).filter(Boolean);
} else {
  let diff = "";
  try {
    diff = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" });
  } catch (e) {
    console.error(`[update-changed-scenes] git diff failed: ${(e as Error).message}`);
    process.exit(1);
  }
  const changed = diff.split("\n").map((s) => s.trim()).filter(Boolean);
  const ids = new Set<string>();
  for (const path of changed) {
    if (fileToId.has(path)) ids.add(fileToId.get(path)!);
    // Also: if registry, index.css tokens, or SceneHost changed, regen all enabled scenes.
    if (
      path === "src/components/home/scenes/registry.ts" ||
      path === "src/components/home/SceneHost.tsx" ||
      path === "src/index.css"
    ) {
      for (const id of fileToId.values()) ids.add(id);
    }
  }
  sceneIds = [...ids];
}

if (sceneIds.length === 0) {
  console.log("[update-changed-scenes] No scene source changes detected — nothing to update.");
  process.exit(0);
}

// 2. Build a grep regex that matches the visual-spec titles:
//   `scene[<id>] @<lang> — token + chrome regression`
const grep = sceneIds.map((id) => `scene\\[${id}\\]`).join("|");
const cmd = `bunx playwright test e2e/home-scenes-visual.spec.ts --update-snapshots -g "${grep}"`;

console.log(`[update-changed-scenes] Updating baselines for: ${sceneIds.join(", ")}`);
if (Object.keys(sceneDiffOverrides).length > 0) {
  console.log(`[update-changed-scenes] scene-diff overrides: ${JSON.stringify(sceneDiffOverrides)}`);
}
if (chromeDiffOverride !== undefined) {
  console.log(`[update-changed-scenes] chrome-diff override: ${chromeDiffOverride}`);
}
if (unknownSceneFlags.length > 0) {
  console.log(`[update-changed-scenes] WARNING: unknown --scene-diff ids: ${unknownSceneFlags.join(", ")}`);
}
console.log(`[update-changed-scenes] $ ${cmd}`);
try {
  execSync(cmd, { stdio: "inherit", env: childEnv });
} catch (e) {
  console.error(`[update-changed-scenes] playwright exited non-zero: ${(e as Error).message}`);
  process.exit(1);
}
