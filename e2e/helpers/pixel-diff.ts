// Pixel-diff knobs shared across screenshot/mask/hit-test specs.
//
// CLI override:
//   PIXEL_DIFF_RATIO=0.05 bunx playwright test e2e/home-scenes-visual.spec.ts
//   PIXEL_DIFF_RATIO=0.005 bun run test:e2e:update:scene
//
// A spec MAY pass `inline` to bump its baseline (e.g. shader specs accept
// slightly more jitter than chrome-only specs); the env value, when set,
// always wins so reviewers can tune the whole run from the command line.
const ENV = process.env.PIXEL_DIFF_RATIO;
const PARSED = ENV !== undefined && ENV !== "" ? Number(ENV) : NaN;

/** Default diff ratio (also mirrored in playwright.config.ts expect block). */
export const DEFAULT_PIXEL_DIFF_RATIO = 0.02;

/** Env-aware override. NaN-safe. */
export const PIXEL_DIFF_RATIO = Number.isFinite(PARSED) ? PARSED : DEFAULT_PIXEL_DIFF_RATIO;

/** Use this for inline maxDiffPixelRatio: env wins, otherwise the spec's value. */
export function diffRatio(inline = DEFAULT_PIXEL_DIFF_RATIO): number {
  return Number.isFinite(PARSED) ? PARSED : inline;
}
