# Plan — Obsidian Ink rewrite + crisp stars

Touches only 2 files. No registry, i18n, CSS, or test changes.

## 1. `src/components/home/scenes/ObsidianInk.tsx` — full rewrite

Throw out the current "stacked radial gradients + 18 rim tendrils" approach. It produces the symmetric bacteria / orbiting-dot look the user is rejecting. Replace with a true noise-distorted blob renderer.

### Blot model
Each blot is rendered as N filled, irregular closed paths — NOT radial gradients, NOT dot stamps.

- **Path generation**: sample `STEPS = 96` angles around the center. For each angle θ, compute distorted radius:
  ```
  r(θ) = baseR * (1 + 0.55 * fbm2(cos θ, sin θ, seed) + 0.25 * fbm2(2·cos θ, 2·sin θ, seed+1))
  ```
  where `fbm2` is 4-octave 2D value-noise sampled on a unit circle (so it's seamless across θ=0/2π). Output range roughly `0.45·baseR … 1.7·baseR` — guarantees asymmetric amoeba contours, no possible ring symmetry.
- **Layered capillary bleed**: stack `LAYERS = 14` of these paths.
  - Layer i scale: `1.0 + i * 0.045` (each slightly larger).
  - Layer i regenerates the path with `seed + i * 17` and a slightly different noise frequency, so each contour is a *different* irregular shape — not concentric copies.
  - Per-layer center jitter: `±baseR * 0.08`.
  - Fill alpha per layer: linearly from `0.05` at the core down to `0.018` at the outermost, exactly in the requested 0.02–0.05 band.
- **Inner dark core**: 2 extra small noise-distorted paths at `0.4·baseR` with alpha `0.06` for the darkest "wet" center. No gradient, just flat dark fill — multiply compounding does the falloff.
- **Color**: flat `rgba(15, 12, 10, α)` — let multiply blend do the work.
- **Optional drip (20%)**: replace bezier-of-radial-stamps with a single elongated noise-distorted path: stretch `r(θ)` by `1 + 1.6 * max(0, -sin θ)` so the blob grows a tongue downward, then layer 6× same as body.

### Multiply blending
Keep `ctx.globalCompositeOperation = "multiply"` wrapping the whole blot pass. Critical so overlapping low-α layers (within one blot AND between blots) compound darker — that's the entire mechanism for capillary realism.

### Paper grain — keep & strengthen
Current `buildPaperTexture` is fine in concept. Tweak:
- Per-pixel noise alpha range from `0..14` → `0..22` (more visible grain).
- Drop the diagonal-fiber strokes (too "drawn"). Replace with a second high-frequency speckle pass at 25% density, slightly warmer tone, alpha 0..10. Result: pure Xuan-paper tooth, no visible structure.
- Draw paper texture **after** the warm washes but **before** ink. Ink is drawn over grain with multiply, so ink visually sits *in* the grain (as requested).

### Counts & guardrails
- `STEPS=96`, `LAYERS=14`, `MAX_BLOTS=7` → ~9,800 path vertices/frame. Still well under budget at `FRAME_MS = 1000/15` (slow down from 18→15 fps since ink barely moves and paths are heavier).
- DPR cap stays at 1.5.
- `lightweight: true` semantic preserved.
- `prefers-reduced-motion` honoured (spawning halts, existing blots hold).

### Deleted code
- `radialStamp()` helper.
- `makeAngularFbm()` (replaced by 2D fbm).
- `BODY_LAYERS`, `FIBER_COUNT`, `DRIP_STAMPS` constants.
- The entire fiber-tendril loop (this is the "ring of dots").

### New helpers
- `fbm2(x, y, seed)` — 4-octave value noise on a 2D grid, hash-based, seeded.
- `buildBlobPath(ctx, cx, cy, baseR, seed, freq, stretch?)` — emits a closed `Path2D`-equivalent via `moveTo`/`lineTo` over 96 angle samples.

## 2. `src/components/home/scenes/neon-vapor.frag.ts` — star rewrite only

Lines 88–90 currently do:
```glsl
float starN = noise(p * 110.0);
sky += vec3(1.0) * smoothstep(0.95, 1.0, starN) * skyT * 0.6;
```
That's continuous bilinear-interpolated value noise thresholded — produces fuzzy blobs ("smudgy"). Replace with the user-specified crisp hash:

```glsl
// Crisp star pinpricks — high-threshold hash, no interpolation.
vec2 starUV = uv * vec2(aspect, 1.0) * 220.0;
vec2 starCell = floor(starUV);
float starHash = fract(sin(dot(starCell, vec2(12.9898, 78.233))) * 43758.5453);
float starMask = step(0.997, starHash);
// Twinkle: per-star phase from same hash, modulates alpha only, edges stay sharp.
float twinkle = 0.6 + 0.4 * sin(u_time * 1.8 + starHash * 31.4);
// Confine the bright pixel to a small sub-cell so it's a true pinprick (~1px).
vec2 cellF = fract(starUV);
float pin = step(0.42, cellF.x) * step(cellF.x, 0.58)
          * step(0.42, cellF.y) * step(cellF.y, 0.58);
sky += vec3(1.0) * starMask * pin * twinkle * skyT;
```

Effect: exactly one ~1px crisp pixel per qualifying cell, twinkles via alpha only, no soft halo, no gradient. Density tuned by the `0.997` threshold (≈0.3% of cells light up).

### Also remove smudge sources
- Line 69 `sky = mix(sky, softPink * 0.5 + deepPurple * 0.5, n1 * 0.35 * skyT);` — keep but reduce factor `0.35 → 0.18`. The drifting fog is currently strong enough to read as "dirty haze behind stars". Lighter fog → cleaner sky.
- Bloom halo around sun (line 86) is fine, it's localized.

`DigitalConstellation` is NOT shared — it already uses discrete `fillRect(x,y,1,1)` for background stars (crisp). No change needed there. (Earlier in this chat the user previously approved its current state.)

## Verification
- Manual visual check at `/` for both light theme (Obsidian Ink) and Neon Vapor.
- `npm run check:home-theme-isolation` (40/40 must still pass).
- E2E visual baselines for these two scenes will need refresh after merge — flag to user, do not auto-update.

## Out of scope
Other 3 scenes, CSS tokens, registry, i18n, SceneHost, Home.tsx, tests.
