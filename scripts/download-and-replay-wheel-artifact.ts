#!/usr/bin/env bun
// Download the failed wheel-scroll CI artifact for a workflow run and
// immediately replay its wheel-diagnostics.json with matching runner env.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Args = {
  runId: string;
  project: string;
  retries: string;
  outDir: string;
  artifact?: string;
  attempt?: string;
  headed: boolean;
};

function usage(): never {
  console.error("Usage: bun run scripts/download-and-replay-wheel-artifact.ts <workflow-run-id> [--project=chromium|firefox|webkit] [--retries=2] [--artifact=<artifact-name>] [--attempt=<n>] [--out-dir=.artifacts/wheel-replay] [--headed]");
  process.exit(2);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    runId: "",
    project: process.env.PLAYWRIGHT_PROJECT ?? "chromium",
    retries: process.env.RETRIES ?? process.env.PLAYWRIGHT_RETRIES ?? "2",
    outDir: join(process.cwd(), ".artifacts", "wheel-replay"),
    headed: process.env.HEADED === "1",
  };
  for (const a of argv) {
    if (a === "--headed") args.headed = true;
    else if (a.startsWith("--project=")) args.project = a.slice("--project=".length);
    else if (a.startsWith("--retries=")) args.retries = a.slice("--retries=".length);
    else if (a.startsWith("--artifact=")) args.artifact = a.slice("--artifact=".length);
    else if (a.startsWith("--attempt=")) args.attempt = a.slice("--attempt=".length);
    else if (a.startsWith("--out-dir=")) args.outDir = a.slice("--out-dir=".length);
    else if (!args.runId) args.runId = a;
    else usage();
  }
  if (!args.runId) usage();
  return args;
}

function run(cmd: string, args: string[], env = process.env) {
  const res = spawnSync(cmd, args, { stdio: "inherit", env });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed with exit ${res.status}`);
}

function findFirst(root: string, fileName: string): string | null {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name === fileName) return path;
    }
  }
  return null;
}

export function buildGhArgs(args: Args): string[] {
  const ghArgs = ["run", "download", args.runId, "--dir", args.outDir];
  if (args.artifact) ghArgs.push("--name", args.artifact);
  else ghArgs.push("--pattern", `e2e-test-results-${args.project}-*`);
  if (args.attempt) ghArgs.push("--attempt", args.attempt);
  return ghArgs;
}

export function main(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  mkdirSync(args.outDir, { recursive: true });
  run("gh", buildGhArgs(args));

  const diagnostics = findFirst(args.outDir, "wheel-diagnostics.json");
  if (!diagnostics) throw new Error(`wheel-diagnostics.json not found after downloading run ${args.runId} into ${args.outDir}`);

  const env = { ...process.env, PLAYWRIGHT_PROJECT: args.project, RETRIES: args.retries };
  const replayOut = join(args.outDir, "replay-output");
  const replayArgs = ["run", "scripts/replay-wheel-diagnostics.ts", diagnostics, `--project=${args.project}`, `--out-dir=${replayOut}`, "--trace=on"];
  if (args.headed) replayArgs.push("--headed");
  console.log(`▶ Replay command: PLAYWRIGHT_PROJECT=${args.project} RETRIES=${args.retries} bun ${replayArgs.join(" ")}`);
  run("bun", replayArgs, env);

  for (const name of ["wheel-diagnostics.json", "scroller.png", "trace.zip"]) {
    const path = name === "wheel-diagnostics.json" ? diagnostics : findFirst(args.outDir, name);
    console.log(`${existsSync(path ?? "") ? "✓" : "-"} ${name}${path ? `: ${path}` : ""}`);
  }
}

if (import.meta.main) {
  try { main(); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); }
}