// Verify that Home's scene-specific tokens never leak into NotePage/Editor/Preview.
//
// Run via `bun run check:home-isolation` (see package.json). CI fails fast if
// any new code path drags a `data-scene`, `data-theme="cyber"`, `data-home-root`,
// `scene-theme-change` event, or `--home-*` CSS var into a /:slug surface.
import { readFileSync } from "node:fs";

const HOME = "src/pages/Home.tsx";
const NOTE_SURFACES = [
  "src/pages/NotePage.tsx",
  "src/components/note/Editor.tsx",
  "src/components/note/Preview.tsx",
];

const home = readFileSync(HOME, "utf8");
const required = [
  "data-home-root",
  "data-scene={hasScene ? scene : undefined}",
  // Legacy attribute, still asserted so the i18n test + leak E2E keep
  // a stable hook to match on.
  'data-theme={isCyber ? "cyber" : undefined}',
];
for (const token of required) {
  if (!home.includes(token)) throw new Error(`Home missing scoped token: ${token}`);
}

const forbidden = [
  "isCyber",
  'data-theme="cyber"',
  "data-theme={isCyber",
  "data-home-root",
  "data-scene=",
  "scene-theme-change",
  "--home-chrome-bg",
  "--home-recents-bg",
  "--home-mask-top",
  "--home-mask-bottom",
  "--home-title-grad",
  "--home-mono-family",
  // Raw scene ids should never appear in a note surface.
  "cyber-linh-khi",
  "ethereal-aurora",
  "obsidian-ink",
  "digital-constellation",
  "neon-vapor",
  "terminal-boot",
];

for (const file of NOTE_SURFACES) {
  const source = readFileSync(file, "utf8");
  for (const token of forbidden) {
    if (source.includes(token)) {
      throw new Error(`${file} leaks Home scene token: ${token}`);
    }
  }
}

console.log("✓ Home scene tokens are isolated from NotePage/Editor/Preview");
