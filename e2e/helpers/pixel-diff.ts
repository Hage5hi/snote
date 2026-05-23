// Pixel-diff knobs shared across screenshot/mask/hit-test specs.
//
// Three override layers (env wins, then per-scene, then inline default):
//
// 1. Global ratio: PIXEL_DIFF_RATIO=0.05 — applies to every comparison.
// 2. Chrome ratio: CHROME_DIFF_RATIO=0.02 — applies only to the masked
//    chrome screenshots in home-scenes-visual.spec.ts (Header/Recents
//    strip). Lets a reviewer tighten chrome gates while loosening scene
//    layer gates separately.
// 3. Per-scene ratio: SCENE_DIFF_RATIOS="neon-vapor=0.05,obsidian-ink=0.01"
//    Or JSON: SCENE_DIFF_RATIOS='{"neon-vapor":0.05}'
//    Wildcard keys (e.g. `neon-*`) are expanded at the CLI layer in
//    scripts/_helpers/scene-diff-args.ts — by the time this file reads
//    SCENE_DIFF_RATIOS, all keys are literal scene ids.
//
// The CI wrapper scripts (e2e-run-changed-scenes, e2e-update-changed-scenes)
// accept `--scene-diff <id|glob>=<ratio>` (repeatable) and `--chrome-diff
// <ratio>` flags and merge them into the env before invoking Playwright:
//
//   bun run test:e2e:update:changed --scene-diff "neon-*=0.05" --chrome-diff 0.015

const ENV = process.env.PIXEL_DIFF_RATIO;
const PARSED = ENV !== undefined && ENV !== "" ? Number(ENV) : NaN;

const CHROME_ENV = process.env.CHROME_DIFF_RATIO;
const CHROME_PARSED =
  CHROME_ENV !== undefined && CHROME_ENV !== "" ? Number(CHROME_ENV) : NaN;

/** Default diff ratio (also mirrored in playwright.config.ts expect block). */
export const DEFAULT_PIXEL_DIFF_RATIO = 0.02;

/** Env-aware global override. NaN-safe. */
export const PIXEL_DIFF_RATIO = Number.isFinite(PARSED) ? PARSED : DEFAULT_PIXEL_DIFF_RATIO;

function parseSceneDiffs(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj)) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) out[k] = n;
      }
      return out;
    } catch {
      /* fall through */
    }
  }
  const out: Record<string, number> = {};
  for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^([^=]+)=([\d.]+)$/);
    if (!m) continue;
    const n = Number(m[2]);
    if (Number.isFinite(n) && n >= 0) out[m[1]] = n;
  }
  return out;
}

const SCENE_OVERRIDES = parseSceneDiffs(process.env.SCENE_DIFF_RATIOS);
// Per-scene chrome overrides (from `--chrome-scene-diff <id|glob>=<ratio>`).
// Globs are expanded at the CLI layer in scripts/_helpers/scene-diff-args.ts,
// so by the time we read CHROME_SCENE_DIFF_RATIOS all keys are literal ids.
const CHROME_SCENE_OVERRIDES = parseSceneDiffs(
  process.env.CHROME_SCENE_DIFF_RATIOS,
);

/** Use this for inline maxDiffPixelRatio: env wins, otherwise the spec's value. */
export function diffRatio(inline = DEFAULT_PIXEL_DIFF_RATIO): number {
  return Number.isFinite(PARSED) ? PARSED : inline;
}

/** Per-scene resolved threshold for the *masked scene layer* / hit-test specs.
 *  Precedence: PIXEL_DIFF_RATIO (global) → SCENE_DIFF_RATIOS (per-scene) →
 *  registry/inline fallback. */
export function sceneDiffRatio(sceneId: string, fallback: number): number {
  if (Number.isFinite(PARSED)) return PARSED;
  if (sceneId in SCENE_OVERRIDES) return SCENE_OVERRIDES[sceneId];
  return fallback;
}

/** Chrome screenshot threshold. Separate axis from sceneDiffRatio so a
 *  reviewer can tighten chrome gates while still tolerating shader jitter
 *  in the masked scene layer. Precedence: PIXEL_DIFF_RATIO (global hard
 *  override) → CHROME_SCENE_DIFF_RATIOS (per-scene chrome override, from
 *  --chrome-scene-diff) → CHROME_DIFF_RATIO (global chrome env) →
 *  SCENE_DIFF_RATIOS (per-scene masked-layer override, legacy fallback) →
 *  registry/inline fallback. */
export function chromeDiffRatio(sceneId: string, fallback: number): number {
  if (Number.isFinite(PARSED)) return PARSED;
  if (sceneId in CHROME_SCENE_OVERRIDES) return CHROME_SCENE_OVERRIDES[sceneId];
  if (Number.isFinite(CHROME_PARSED)) return CHROME_PARSED;
  if (sceneId in SCENE_OVERRIDES) return SCENE_OVERRIDES[sceneId];
  return fallback;
}

/** Exposed for diagnostics (e.g. logging the resolved value in a spec). */
export function sceneDiffOverride(sceneId: string): number | undefined {
  return SCENE_OVERRIDES[sceneId];
}

/** Exposed for diagnostics — was --chrome-diff / CHROME_DIFF_RATIO set? */
export function chromeDiffOverride(): number | undefined {
  return Number.isFinite(CHROME_PARSED) ? CHROME_PARSED : undefined;
}

/** Exposed for diagnostics — was a per-scene --chrome-scene-diff set
 *  for this id? Lets specs annotate the resolved value in the CI summary. */
export function chromeSceneDiffOverride(sceneId: string): number | undefined {
  return CHROME_SCENE_OVERRIDES[sceneId];
}
