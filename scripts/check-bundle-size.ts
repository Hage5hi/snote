#!/usr/bin/env bun
// Phase 8 — Bundle size gate.
// Runs after `vite build`. Reads dist/, gzips each chunk, compares to threshold table.
// Fails if chunks exceed limits or lazy-only libs leak into modulepreload list.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = "dist";
const ASSETS = join(DIST, "assets");
const HTML = join(DIST, "index.html");

interface Rule {
  prefix: string;
  label: string;
  maxGz: number;
}

// Thresholds: Phase 7 baseline + ~10-15% headroom for normal feature work.
// When exceeded, either fix code or bump threshold (PR review).
const CHUNK_RULES: Rule[] = [
  // Entry threshold was raised from 45KB to 75KB in Phase 9 (perf PR #3).
  // PR #3 collapsed the previously-manual `chunk-a8f3` (which had been
  // absorbing shared utilities like `use-toast` and shadcn primitives) into
  // the entry chunk where Rollup correctly places shared code. The entry
  // is now ~72KB gz, but the OVERALL initial route is ~30KB lighter (the
  // entire 740KB `mermaid-vendor` no longer leaks into the eager graph).
  // The total-initial-route gate below remains the real protection.
  { prefix: "index-", label: "entry", maxGz: 75_000 },
  { prefix: "react-vendor-", label: "react-vendor", maxGz: 68_000 },
  { prefix: "supabase-vendor-", label: "supabase-vendor", maxGz: 58_000 },
  { prefix: "radix-vendor-", label: "radix-vendor", maxGz: 35_000 },
  { prefix: "yjs-vendor-", label: "yjs-vendor", maxGz: 35_000 },
  { prefix: "md-vendor-", label: "md-vendor", maxGz: 38_000 },
  { prefix: "chunk-a8f3-", label: "admin", maxGz: 22_000 },
];

// Init route preload: sum gzip of chunks in <link rel="modulepreload"> + entry.
const INIT_ROUTE_TOTAL_MAX_GZ = 250_000;

// Phase 3.1 invariant: these libs are lazy-only and must NOT be in modulepreload.
const FORBIDDEN_IN_PRELOAD = [
  "mermaid-vendor",
  "katex-vendor",
  "hljs-vendor",
  "wardley",
  "preview-worker",
  // Admin panel (obfuscated) is lazy-loaded only when an admin signs in.
  "chunk-a8f3",
  // QR vendor is lazy-loaded only when user opens the share dialog.
  "qrcode-vendor",
  // UnlockForm chunk is lazy-loaded only on encrypted notes.
  "UnlockForm",
];

function gzSize(filePath: string): number {
  return gzipSync(readFileSync(filePath)).length;
}

function fmt(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function parsePreloadChunks(html: string): string[] {
  const matches = [
    ...html.matchAll(/rel="modulepreload"[^>]*href="\/assets\/([^"]+)"/g),
  ];
  return matches.map((m) => m[1]);
}

function main(): number {
  if (!existsSync(DIST)) {
    console.error(`✗ ${DIST}/ not found. Run \`bun run build\` first.`);
    return 1;
  }
  if (!existsSync(HTML)) {
    console.error(`✗ ${HTML} not found.`);
    return 1;
  }

  const html = readFileSync(HTML, "utf-8");
  const preloadChunks = parsePreloadChunks(html);
  const assetFiles = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));

  let failed = 0;
  console.log("=== Bundle size gate ===\n");

  // Check 1: Per-chunk thresholds.
  console.log("Chunk size checks:");
  for (const rule of CHUNK_RULES) {
    const match = assetFiles.find((f) => f.startsWith(rule.prefix));
    if (!match) {
      console.log(`  ⊘ ${rule.label}: chunk not found (skipped)`);
      continue;
    }
    const size = gzSize(join(ASSETS, match));
    const pass = size <= rule.maxGz;
    const symbol = pass ? "✓" : "✗";
    const status = pass ? "ok" : `EXCEEDS (max ${fmt(rule.maxGz)})`;
    console.log(
      `  ${symbol} ${rule.label.padEnd(20)} ${fmt(size).padStart(10)}  ${status}`,
    );
    if (!pass) failed++;
  }

  // Check 2: Initial route total (entry + preloaded chunks).
  console.log("\nInitial route total:");
  let initTotal = 0;
  const entryMatch = assetFiles.find((f) => f.startsWith("index-"));
  if (entryMatch) initTotal += gzSize(join(ASSETS, entryMatch));
  for (const chunk of preloadChunks) {
    if (existsSync(join(ASSETS, chunk))) {
      initTotal += gzSize(join(ASSETS, chunk));
    }
  }
  const initPass = initTotal <= INIT_ROUTE_TOTAL_MAX_GZ;
  console.log(
    `  ${initPass ? "✓" : "✗"} total preloaded  ${fmt(initTotal).padStart(10)}  (max ${fmt(INIT_ROUTE_TOTAL_MAX_GZ)})`,
  );
  if (!initPass) failed++;

  // Check 3: Forbidden-in-preload invariant (Phase 3.1).
  console.log("\nLazy-only chunks NOT in modulepreload:");
  for (const banned of FORBIDDEN_IN_PRELOAD) {
    const violation = preloadChunks.find((c) => c.includes(banned));
    if (violation) {
      console.log(`  ✗ ${banned}: FOUND in preload list (${violation})`);
      failed++;
    } else {
      console.log(`  ✓ ${banned}: not preloaded`);
    }
  }

  console.log();
  if (failed > 0) {
    console.error(`✗ Bundle size gate FAILED — ${failed} violation(s).`);
    console.error(
      `  Fix code, or update thresholds in scripts/check-bundle-size.ts (PR review required).`,
    );
    return 1;
  }
  console.log("✓ Bundle size gate passed.");
  return 0;
}

process.exit(main());
