#!/usr/bin/env bun
// PR-mode E2E runner: execute the FULL safety net (WebGL fallback + smoke
// + every non-visual spec) on every run, but only run the visual-regression
// suite for scenes whose source changed in this PR.
//
// This keeps PR feedback fast (a small shader tweak doesn't re-snapshot 12
// chrome baselines on 3 browsers) without ever skipping the WebGL fallback
// path or the smoke specs that protect everyone.
//
// Usage:
//   bun run scripts/e2e-run-changed-scenes.ts                      # auto-detect base
//   bun run scripts/e2e-run-changed-scenes.ts --base origin/main
//   bun run scripts/e2e-run-changed-scenes.ts --all                # run visual for all
//   PIXEL_DIFF_RATIO=0.04 PLAYWRIGHT_PROJECT=chromium bun run ...
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const ALL = args.includes("--all");
const BASE = flag("--base") ?? safeMergeBase("origin/main");

// Specs that ALWAYS run regardless of diff — these protect the fallback
// path + the registry/host integration that every scene depends on.
const ALWAYS_RUN = [
  "e2e/webgl-fallback.spec.ts",
  "e2e/home-scene.spec.ts", // smoke + i18n + a11y on Cyber scene
];
// Specs that NEVER run in PR-mode unless their files (or shared infra)
// changed. The visual regression suite is the only "skip when scope-empty"
// candidate today.
const VISUAL_SPEC = "e2e/home-scenes-visual.spec.ts";

function safeMergeBase(ref: string): string {
  try {
    return execSync(`git merge-base HEAD ${ref}`, { encoding: "utf8" }).trim();
  } catch {
    return "HEAD~1";
  }
}

// Map registry source files → scene ids (same logic as e2e-update-changed-scenes).
function loadFileToId(): Map<string, string> {
  const txt = readFileSync(resolve("src/components/home/scenes/registry.ts"), "utf8");
  const out = new Map<string, string>();
  for (const block of txt.split(/\{\s*\n/).slice(1)) {
    const id = block.match(/id:\s*["']([^"']+)["']/)?.[1];
    const file = block.match(/import\(\s*["']\.\/([^"']+)["']/)?.[1];
    if (id && file) out.set(`src/components/home/scenes/${file}.tsx`, id);
  }
  return out;
}

function detectChangedScenes(): { ids: string[]; runVisual: boolean; reason: string } {
  if (ALL) return { ids: [], runVisual: true, reason: "--all flag" };
  let diff = "";
  try {
    diff = execSync(`git diff --name-only ${BASE}...HEAD`, { encoding: "utf8" });
  } catch (e) {
    console.warn(`[run-changed-scenes] git diff failed (${(e as Error).message}); running full visual suite`);
    return { ids: [], runVisual: true, reason: "diff-failed" };
  }
  const changed = diff.split("\n").map((s) => s.trim()).filter(Boolean);
  const fileToId = loadFileToId();
  const ids = new Set<string>();
  let runAllVisual = false;
  for (const path of changed) {
    if (fileToId.has(path)) ids.add(fileToId.get(path)!);
    // Shared infra → re-run every scene's visual baseline.
    if (
      path === "src/components/home/scenes/registry.ts" ||
      path === "src/components/home/SceneHost.tsx" ||
      path === "src/index.css" ||
      path === VISUAL_SPEC ||
      path === "playwright.config.ts" ||
      path === "e2e/helpers/pixel-diff.ts"
    ) {
      runAllVisual = true;
    }
  }
  if (runAllVisual) return { ids: [], runVisual: true, reason: "shared-infra changed" };
  if (ids.size > 0) return { ids: [...ids], runVisual: true, reason: `scenes changed: ${[...ids].join(", ")}` };
  return { ids: [], runVisual: false, reason: "no scene/visual changes" };
}

function run(cmd: string[], env: NodeJS.ProcessEnv = process.env): number {
  console.log(`[run-changed-scenes] $ ${cmd.join(" ")}`);
  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", env });
  return res.status ?? 1;
}

const { ids, runVisual, reason } = detectChangedScenes();
console.log(`[run-changed-scenes] visual scope: ${reason}`);

// 1. Always run the safety-net specs.
let exit = run(["bunx", "playwright", "test", ...ALWAYS_RUN]);

// 2. Visual regression — full suite or scoped grep.
if (runVisual) {
  const cmd = ["bunx", "playwright", "test", VISUAL_SPEC];
  if (ids.length > 0) {
    // -g filters by test title; spec titles are `scene[<id>] @<lang> — ...`
    // and `every enabled scene can be selected at runtime` (keep that too).
    const grep = [
      ...ids.map((id) => `scene\\[${id}\\]`),
      "every enabled scene can be selected at runtime",
    ].join("|");
    cmd.push("-g", grep);
  }
  const visualExit = run(cmd);
  if (visualExit !== 0) exit = visualExit;
} else {
  console.log("[run-changed-scenes] skipping visual regression suite (no scope)");
}

process.exit(exit);
