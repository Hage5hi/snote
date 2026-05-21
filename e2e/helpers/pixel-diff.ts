// Pixel-diff knobs shared across screenshot/mask/hit-test specs.
//
// Two override layers (env wins, then per-scene, then inline default):
//
// 1. Global ratio: PIXEL_DIFF_RATIO=0.05 — applies to every comparison.
// 2. Per-scene ratio: SCENE_DIFF_RATIOS="neon-vapor=0.05,obsidian-ink=0.01"
//    Or JSON: SCENE_DIFF_RATIOS='{"neon-vapor":0.05}'
//
// The CI wrapper scripts (e2e-run-changed-scenes, e2e-update-changed-scenes)
// accept `--scene-diff <id>=<ratio>` flags (repeatable) and merge them into
// SCENE_DIFF_RATIOS before invoking Playwright, so a reviewer can tune a
// single shader's gate without editing the registry:
//
//   bun run test:e2e:update:changed --scene-diff neon-vapor=0.05
const ENV = process.env.PIXEL_DIFF_RATIO;
const PARSED = ENV !== undefined && ENV !== "" ? Number(ENV) : NaN;

/** Default diff ratio (also mirrored in playwright.config.ts expect block). */
export const DEFAULT_PIXEL_DIFF_RATIO = 0.02;

/** Env-aware global override. NaN-safe. */
export const PIXEL_DIFF_RATIO = Number.isFinite(PARSED) ? PARSED : DEFAULT_PIXEL_DIFF_RATIO;

function parseSceneDiffs(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  // Try JSON first.
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
      // fall through to KV parsing
    }
  }
  // KV form: "id=ratio,id=ratio".
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

/** Use this for inline maxDiffPixelRatio: env wins, otherwise the spec's value. */
export function diffRatio(inline = DEFAULT_PIXEL_DIFF_RATIO): number {
  return Number.isFinite(PARSED) ? PARSED : inline;
}

/** Per-scene resolved threshold. Precedence: PIXEL_DIFF_RATIO env (global)
 *  → SCENE_DIFF_RATIOS env (per-scene) → registry/inline fallback. */
export function sceneDiffRatio(sceneId: string, fallback: number): number {
  if (Number.isFinite(PARSED)) return PARSED;
  if (sceneId in SCENE_OVERRIDES) return SCENE_OVERRIDES[sceneId];
  return fallback;
}

/** Exposed for diagnostics (e.g. logging the resolved value in a spec). */
export function sceneDiffOverride(sceneId: string): number | undefined {
  return SCENE_OVERRIDES[sceneId];
}
