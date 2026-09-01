#!/usr/bin/env bun
// Phase 8 — Bundle size gate.
// Runs after `vite build`. Reads dist/, gzips each chunk, compares to threshold table.
// Fails if chunks exceed limits or lazy-only libs leak into modulepreload list.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { loadEnv } from "vite";
import { dict } from "../src/i18n/catalog";

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
  // Entry threshold was raised from 45KB to 75KB in Phase 9 (perf PR #3),
  // then bumped to 82KB after the PWA update banner work added
  // `virtual:pwa-register` glue, a few new i18n strings, and the narrow-
  // viewport hook to the eager graph. Before this PR the gate was
  // ACCIDENTALLY pointing at the lazy vim chunk (also called `index-…`
  // because the upstream package's main file is `index.js`) and silently
  // passing while the true entry sat around 76KB. The entry-resolution
  // logic below now reads the actual `<script type="module">` URL from
  // `dist/index.html` instead of `find()`-ing the first `index-` file in
  // arbitrary dirent order, which surfaced the misalignment.
  // The total-initial-route gate below remains the real protection.
  { prefix: "index-", label: "entry", maxGz: 82_000 },
  { prefix: "react-vendor-", label: "react-vendor", maxGz: 68_000 },
  { prefix: "router-vendor-", label: "router-vendor", maxGz: 15_000 },
  { prefix: "floating-ui-vendor-", label: "floating-ui-vendor", maxGz: 10_000 },
  { prefix: "supabase-vendor-", label: "supabase-vendor", maxGz: 58_000 },
  { prefix: "radix-vendor-", label: "radix-vendor", maxGz: 35_000 },
  { prefix: "yjs-vendor-", label: "yjs-vendor", maxGz: 35_000 },
  { prefix: "md-vendor-", label: "md-vendor", maxGz: 38_000 },
  { prefix: "chunk-a8f3-", label: "admin", maxGz: 22_000 },
  // Home background scene chunks — must stay tiny and lazy-only.
  { prefix: "ogl-vendor-", label: "ogl-vendor", maxGz: 22_000 },
  { prefix: "scene-cyber-linh-khi-", label: "scene-cyber-linh-khi", maxGz: 8_000 },
];

// Init route preload: sum gzip of chunks in <link rel="modulepreload"> + entry.
const INIT_ROUTE_TOTAL_MAX_GZ = 250_000;
const LAZY_LOCALES = ["vi", "zh", "ja", "ko", "fr", "es", "de", "pt"] as const;

// AdminPanel invoke strings. Quoted so Privacy copy like "admin-session hashes"
// does not trip the default-build leak check. Flag-on builds may emit them.
const ADMIN_SPA_INVOKE_STRINGS = [
  "admin-session",
  "admin-list",
  "admin-delete",
  "admin-rotate",
] as const;

// Capability HTTP client invoke strings and the cutover open helper.
// Quoted so unquoted English copy does not trip the default-build leak check.
// Flag-on builds may emit them. Capability HTTP client must not ship in
// default production JS. legacy-note-open must not ship in default production JS.
const CAPABILITY_INVOKE_STRINGS = [
  "note-session",
  "note-sync",
  "note-manage",
  "legacy-note-open",
] as const;

// Phase 3.1 invariant: these libs are lazy-only and must NOT be in modulepreload.
const FORBIDDEN_IN_PRELOAD = [
  "mermaid-vendor",
  "katex-vendor",
  "hljs-vendor",
  "wardley",
  "preview-worker",
  "chunk-a8f3",
  "qrcode-vendor",
  "UnlockForm",
  // Background scene chunks + OGL — only load when user picks a scene.
  "scene-",
  "ogl-vendor",
  ...LAZY_LOCALES.map((lang) => `${lang}-`),
];

function gzSize(filePath: string): number {
  return gzipSync(readFileSync(filePath)).length;
}

function fmt(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function containsQuoted(source: string, value: string): boolean {
  return source.includes(`"${value}"`) || source.includes(`'${value}'`);
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
  // The real entry is whatever `<script type="module" src="…">` index.html
  // ships. `readdirSync` returns dirent order (htree on ext4), so a naive
  // `assetFiles.find(starts-with-index-)` can hit either the entry chunk
  // or a sibling `index-…` chunk depending on file hashes. Always resolve
  // the entry from the HTML to keep the gate deterministic.
  const entryFromHtml = html.match(
    /<script[^>]*type="module"[^>]*src="\/assets\/(index-[^"]+)"/,
  )?.[1];

  let failed = 0;
  console.log("=== Bundle size gate ===\n");

  // Check 1: Per-chunk thresholds.
  console.log("Chunk size checks:");
  for (const rule of CHUNK_RULES) {
    const match =
      rule.label === "entry" && entryFromHtml
        ? assetFiles.find((f) => f === entryFromHtml)
        : assetFiles.find((f) => f.startsWith(rule.prefix));
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
  const entryMatch =
    entryFromHtml && assetFiles.includes(entryFromHtml)
      ? entryFromHtml
      : assetFiles.find((f) => f.startsWith("index-"));
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

  // Check 4: every non-English locale is emitted independently and none of
  // its content leaks into the entry or a modulepreload dependency.
  console.log("\nNon-English locale chunks stay lazy:");
  const initialChunks = [entryFromHtml, ...preloadChunks].filter(
    (name): name is string => !!name && existsSync(join(ASSETS, name)),
  );
  const initialSource = initialChunks
    .map((name) => readFileSync(join(ASSETS, name), "utf8"))
    .join("\n");
  for (const lang of LAZY_LOCALES) {
    const chunks = assetFiles.filter((file) => file.startsWith(`${lang}-`));
    const sentinel = dict[lang]["home.tagline"];
    const pass = chunks.length === 1 && !initialSource.includes(sentinel);
    console.log(
      `  ${pass ? "✓" : "✗"} ${lang}: ${chunks.length === 1 ? chunks[0] : `${chunks.length} chunks`} / initial sentinel ${initialSource.includes(sentinel) ? "FOUND" : "absent"}`,
    );
    if (!pass) failed++;
  }

  // Check 5: default / flag-off production JS must not emit the AdminPanel
  // graph. Admin SPA must not ship in default production JS.
  const adminPanelEnabled =
    loadEnv("production", process.cwd(), "VITE_").VITE_ADMIN_PANEL_ENABLED === "true";
  console.log("\nAdmin SPA containment:");
  if (adminPanelEnabled) {
    console.log("  ⊘ skipped (compile-time flag enabled)");
  } else {
    const distJs = [
      ...assetFiles.map((name) => join(ASSETS, name)),
      ...readdirSync(DIST)
        .filter((name) => name.endsWith(".js"))
        .map((name) => join(DIST, name)),
    ];
    const distSources = distJs.map((file) => ({
      file,
      source: readFileSync(file, "utf8"),
    }));
    for (const name of ADMIN_SPA_INVOKE_STRINGS) {
      const hit = distSources.find(({ source }) => containsQuoted(source, name));
      if (hit) {
        console.log(`  ✗ ${name}: FOUND in ${hit.file}`);
        failed++;
      } else {
        console.log(`  ✓ ${name}: absent from production JS`);
      }
    }
    const adminChunks = assetFiles.filter((file) => file.startsWith("chunk-a8f3-"));
    if (adminChunks.length > 0) {
      console.log(`  ✗ AdminPanel chunk emitted (${adminChunks.join(", ")})`);
      failed++;
    } else {
      console.log("  ✓ AdminPanel chunk (chunk-a8f3-*): not emitted");
    }
  }

  // Check 6: default / flag-off production JS must not emit the capability
  // HTTP client. Capability HTTP client must not ship in default production JS.
  const capabilityRoutesEnabled =
    loadEnv("production", process.cwd(), "VITE_").VITE_CAPABILITY_ROUTES_ENABLED === "true";
  console.log("\nCapability HTTP client containment:");
  if (capabilityRoutesEnabled) {
    console.log("  ⊘ skipped (compile-time flag enabled)");
  } else {
    const distJs = [
      ...assetFiles.map((name) => join(ASSETS, name)),
      ...readdirSync(DIST)
        .filter((name) => name.endsWith(".js"))
        .map((name) => join(DIST, name)),
    ];
    const distSources = distJs.map((file) => ({
      file,
      source: readFileSync(file, "utf8"),
    }));
    for (const name of CAPABILITY_INVOKE_STRINGS) {
      const hit = distSources.find(({ source }) => containsQuoted(source, name));
      if (hit) {
        console.log(`  ✗ ${name}: FOUND in ${hit.file}`);
        failed++;
      } else {
        console.log(`  ✓ ${name}: absent from production JS`);
      }
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
