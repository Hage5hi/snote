// Verify that scene tokens / SceneHost stay OUT of the AdminPanel surface.
//
// Scenes were previously Home-only; they now also wrap NotePage, SplitView,
// and SharePage via <AppShell>. AdminPanel is the only public surface that
// must stay neutral (no scene leakage, no SceneHost mount, no hard-coded
// scene id).
//
// Run via `bun run check:home-isolation` (see package.json). CI fails fast if
// any new code path drags a `data-scene`, `data-theme="cyber"`, `data-home-root`,
// `scene-theme-change` event, or `--home-*` CSS var into a /:slug surface.
import { readFileSync } from "node:fs";

const HOME = "src/pages/Home.tsx";
const NEUTRAL_SURFACES = ["src/pages/AdminPanel.tsx"];

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
  "SceneHost",
  "AppShell",
  // Raw scene ids should never appear in a neutral surface.
  "cyber-linh-khi",
  "ethereal-aurora",
  "obsidian-ink",
  "digital-constellation",
  "neon-vapor",
  "terminal-boot",
];

for (const file of NEUTRAL_SURFACES) {
  const source = readFileSync(file, "utf8");
  for (const token of forbidden) {
    if (source.includes(token)) {
      throw new Error(`${file} leaks scene token: ${token}`);
    }
  }
}

console.log("✓ Scene tokens are isolated from AdminPanel");
