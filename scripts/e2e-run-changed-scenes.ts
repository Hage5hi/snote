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
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSceneDiffFlags,
  loadKnownSceneIds,
  writeSceneDiffExpansionsLog,
  SCENE_DIFF_HELP,
} from "./_helpers/scene-diff-args";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun run scripts/e2e-run-changed-scenes.ts [options]

Runs Playwright safety-net specs every time + the visual-regression suite
scoped to scenes that changed in this PR.

Options:
  --base <ref>     Git ref to diff against (default: merge-base origin/main).
  --all            Run the visual suite for every scene regardless of diff.

${SCENE_DIFF_HELP}
`);
  process.exit(0);
}
const ALL = args.includes("--all");
const BASE = flag("--base") ?? safeMergeBase("origin/main");
const KNOWN_IDS = loadKnownSceneIds();
const {
  env: CHILD_ENV,
  overrides: SCENE_DIFF_OVERRIDES,
  chromeDiff: CHROME_DIFF_OVERRIDE,
  unknown: UNKNOWN_SCENE_FLAGS,
  expansions: SCENE_DIFF_EXPANSIONS,
} = parseSceneDiffFlags(args, { knownSceneIds: KNOWN_IDS });

// Persist wildcard expansions so ci-e2e-summary can list pattern → ids.
const EXPANSIONS_LOG =
  process.env.SCENE_DIFF_EXPANSIONS_LOG ??
  "test-results/scene-diff-expansions.json";
writeSceneDiffExpansionsLog(SCENE_DIFF_EXPANSIONS, EXPANSIONS_LOG);

// Specs that ALWAYS run regardless of diff.
const ALWAYS_RUN = [
  "e2e/webgl-fallback.spec.ts",
  "e2e/home-scene.spec.ts", // smoke + i18n + a11y on Cyber scene
];
const VISUAL_SPEC = "e2e/home-scenes-visual.spec.ts";

// "Shared renderer infra" — touching any of these can change every scene's
// rendered chrome, so we run the full visual suite even when no scene file
// changed. Glob-style prefixes (ending with `/`) match all descendants.
//
// Keep this list explicit (not a full-graph walk) so it's predictable and
// reviewable. If we miss a renderer-affecting file, the fix is to add it
// here rather than to rebuild a dependency graph at CI time.
const SHARED_RENDERER_PATHS: string[] = [
  // Direct scene infra
  "src/components/home/scenes/registry.ts",
  "src/components/home/SceneHost.tsx",
  "src/components/home/", // any shared chrome (Header, Recents, etc.)
  // Tokens + global styling that scene CSS variables sit on top of
  "src/index.css",
  "tailwind.config.ts",
  // Routes / theme provider that mount the Home chrome
  "src/pages/Home.tsx",
  "src/components/ThemeToggle.tsx",
  // shadcn primitives used by the chrome — input, button, dropdown.
  // We narrow to the files the chrome actually imports; touching an
  // unrelated primitive (e.g. accordion) doesn't trigger a full run.
  "src/components/ui/button.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/dropdown-menu.tsx",
  // E2E pipeline that feeds the visual suite
  VISUAL_SPEC,
  "e2e/helpers/pixel-diff.ts",
  "e2e/helpers/", // any shared E2E helper (seedScene lives here once extracted)
  "playwright.config.ts",
];

function isSharedRendererPath(p: string): boolean {
  for (const entry of SHARED_RENDERER_PATHS) {
    if (entry.endsWith("/")) {
      if (p.startsWith(entry)) return true;
    } else if (p === entry) {
      return true;
    }
  }
  return false;
}

function safeMergeBase(ref: string): string {
  try {
    return execSync(`git merge-base HEAD ${ref}`, { encoding: "utf8" }).trim();
  } catch {
    return "HEAD~1";
  }
}

// Map registry source files → scene ids (same logic as e2e-update-changed-scenes).
function loadFileToId(): Map<string, string> {
  const registryPath = resolve("src/components/home/scenes/registry.ts");
  if (!existsSync(registryPath)) return new Map();
  const txt = readFileSync(registryPath, "utf8");
  const out = new Map<string, string>();
  for (const block of txt.split(/\{\s*\n/).slice(1)) {
    const id = block.match(/id:\s*["']([^"']+)["']/)?.[1];
    const file = block.match(/import\(\s*["']\.\/([^"']+)["']/)?.[1];
    if (id && file) out.set(`src/components/home/scenes/${file}.tsx`, id);
  }
  return out;
}

function detectChangedScenes(): {
  ids: string[];
  runVisual: boolean;
  reason: string;
  sharedHits: string[];
} {
  if (ALL) return { ids: [], runVisual: true, reason: "--all flag", sharedHits: [] };
  let diff = "";
  try {
    diff = execSync(`git diff --name-only ${BASE}...HEAD`, { encoding: "utf8" });
  } catch (e) {
    console.warn(`[run-changed-scenes] git diff failed (${(e as Error).message}); running full visual suite`);
    return { ids: [], runVisual: true, reason: "diff-failed", sharedHits: [] };
  }
  const changed = diff.split("\n").map((s) => s.trim()).filter(Boolean);
  const fileToId = loadFileToId();
  const ids = new Set<string>();
  const sharedHits: string[] = [];
  for (const path of changed) {
    if (fileToId.has(path)) ids.add(fileToId.get(path)!);
    if (isSharedRendererPath(path)) sharedHits.push(path);
  }
  if (sharedHits.length > 0) {
    return {
      ids: [],
      runVisual: true,
      reason: `shared renderer paths touched: ${sharedHits.slice(0, 5).join(", ")}${sharedHits.length > 5 ? ` (+${sharedHits.length - 5})` : ""}`,
      sharedHits,
    };
  }
  if (ids.size > 0) {
    return { ids: [...ids], runVisual: true, reason: `scenes changed: ${[...ids].join(", ")}`, sharedHits: [] };
  }
  return { ids: [], runVisual: false, reason: "no scene/visual changes", sharedHits: [] };
}

function run(cmd: string[], env: NodeJS.ProcessEnv = process.env): number {
  console.log(`[run-changed-scenes] $ ${cmd.join(" ")}`);
  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", env });
  return res.status ?? 1;
}

const { ids, runVisual, reason } = detectChangedScenes();
console.log(`[run-changed-scenes] visual scope: ${reason}`);
if (Object.keys(SCENE_DIFF_OVERRIDES).length > 0) {
  console.log(`[run-changed-scenes] scene-diff overrides: ${JSON.stringify(SCENE_DIFF_OVERRIDES)}`);
}
if (CHROME_DIFF_OVERRIDE !== undefined) {
  console.log(`[run-changed-scenes] chrome-diff override: ${CHROME_DIFF_OVERRIDE}`);
}
if (UNKNOWN_SCENE_FLAGS.length > 0) {
  console.log(`[run-changed-scenes] WARNING: unknown --scene-diff ids: ${UNKNOWN_SCENE_FLAGS.join(", ")}`);
}

// 1. Always run the safety-net specs.
let exit = run(["bunx", "playwright", "test", ...ALWAYS_RUN], CHILD_ENV);

// 2. Visual regression — full suite or scoped grep.
if (runVisual) {
  const cmd = ["bunx", "playwright", "test", VISUAL_SPEC];
  if (ids.length > 0) {
    const grep = [
      ...ids.map((id) => `scene\\[${id}\\]`),
      "every enabled scene can be selected at runtime",
    ].join("|");
    cmd.push("-g", grep);
  }
  const visualExit = run(cmd, CHILD_ENV);
  if (visualExit !== 0) exit = visualExit;
} else {
  console.log("[run-changed-scenes] skipping visual regression suite (no scope)");
}

process.exit(exit);
