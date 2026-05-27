# Upgrade Plan — Obsidian Ink & Zodiac Constellation

Only `src/components/home/scenes/ObsidianInk.tsx` and `src/components/home/scenes/DigitalConstellation.tsx` change. No edits to registry, i18n, SceneHost, Home.tsx, theme hooks, or CSS tokens. The `lightweight: true` flag, `forceColorScheme`, paused gating, `onReady` callback, ResizeObserver lifecycle, and `aria-hidden` host wrapper all stay identical.

---

## 1. Obsidian Ink — soft sumi diffusion

**Goal:** replace the current polygon + 3-ring "contour" blot (which reads as topographic banding) with smooth radial diffusion that bleeds organically and darkens on overlap, on a paper-textured ground.

**Algorithm (Canvas2D, no WebGL):**

- **Paper ground (one-time offscreen):** keep the existing `buildPaperTexture` (grain + fibers) and the warm corner washes — those already read well. Tone the base from `#f5f0e6` slightly warmer/cooler only if needed during QA; do not rebuild.
- **Blot model — replace polygon with layered radial gradients:**
  - Each blot has: `x, y, baseR, bornAt, seed, vertices` (kept), drop `drip` ring stroke logic.
  - Render each blot as **6–8 stacked radial gradients** (`ctx.createRadialGradient`) at slightly jittered centers (≤ `0.15*baseR` offset) and slightly varying radii (`0.85*baseR` … `1.9*baseR`). Each gradient: dark center `rgba(20,16,12, a)` → fully transparent at edge. Alphas taper from ~`0.35` (innermost, smallest) to ~`0.03` (outermost, widest). Sum produces a smooth, non-banded falloff — no visible contour steps.
  - **Edge fiber bleed:** for each blot, draw 14–22 tiny radial gradient "tendrils" at the rim. Each tendril = a small radial gradient (`r ≈ 0.08*baseR`) placed at angle `θ` on a perturbed radius `baseR * (1 + 0.18 * fbm(θ, seed))`, with low alpha (~`0.10`). Use a 2-octave value-noise/`mulberry32`-driven `fbm(θ)` so the rim looks like capillary action into paper fibers — irregular but continuous, never spiky.
  - **Drip:** keep optional 20% drip as today, but render it via the same stacked-radial technique along a Bezier (5–7 small radial gradient stamps along the curve, alpha tapering).
- **Multiply blend for overlap darkening:** wrap the entire blot pass in `ctx.globalCompositeOperation = "multiply"` (already partly used) and ensure each gradient stamp commits under multiply. Overlapping blots will compound naturally like real ink.
- **Fade-in / fade-out / TTL:** keep existing `FADE_IN_MS`, `FADE_OUT_MS`, `BLOT_TTL_MS`, `MAX_BLOTS`, `SPAWN_INTERVAL_MS`, multiplied into per-stamp alpha (one global `alphaMul`).
- Delete: `blotPolygon`, `tracePolygon`, wet-edge polygon stroke, taper-stroke drip block (replaced by radial-stamp drip).

**Performance:**
- Keep `FRAME_MS = 1000/18` (already well under 30fps cap).
- Stacked gradients are cheap; total stamps per frame ≈ `MAX_BLOTS (7) * (8 body + 18 fiber) ≈ 180`, all small. Acceptable on integrated GPUs.
- DPR cap stays `1.5`.

---

## 2. Zodiac Constellation — living star map with parallax

**Goal:** keep the 12 hand-drawn zodiac shapes (they read instantly) but embed them inside a deep, parallax starfield with dynamically pulsing connection lines, so it feels like an animated celestial map instead of clip-art.

**Layer model (back → front):**

1. **Deep background gradient** — keep current `#06091a` → `#0c1530`.
2. **Far starfield (parallax z=0.3):** ~220 stars, 1px, alpha `0.08–0.22`, very slight pointer drift (`2px * mx,my`). Twinkle: per-star phase `sin(t * 0.6 + phase)` modulating alpha by ±25%.
3. **Mid starfield (parallax z=0.6):** ~110 stars, 1–1.5px, alpha `0.18–0.40`, drift `5px`. Stronger twinkle ±35%.
4. **Drifting dust (parallax z=0.8):** ~30 slowly drifting motes, very faint (`alpha ≤ 0.08`), tiny velocity (~0.04 px/frame), wrap on edges. Adds subtle flow.
5. **Zodiac layer (parallax z=1.0):** the 12 constellations, drift `10–14px`. Keep `ZODIAC` data, `placeAll`, jittered grid, rotation, and `name` labels.

Replace the current 3-band `PARALLAX_OFFSET[zBand]` with this true 4-layer system (zodiacs all share the front layer; the depth now comes from the 3 background layers below them).

**Live connection lines (per zodiac edge):**
- Compute a per-edge phase from `(constellationIndex * 7 + edgeIndex) * 0.91`.
- Per-frame edge intensity: `glow = 0.55 + 0.45 * sin(t * 0.0011 + phase)` → modulates stroke alpha (`0.18 → 0.55`) and lineWidth (`0.55 → 1.05`). Each constellation breathes at its own cadence, never all in sync.
- Stars at vertices: base halo radius modulated by a slower `sin(t * 0.0006 + phase) * 0.5 + 0.5` → subtle "ancient diagram pulsing" feel.
- Existing periodic full-constellation pulse stays — but lower peak (`pulseAmt * 0.8`) so it layers over the new ambient breathing instead of dominating.

**Pointer interaction:**
- Keep the smoothed `mx,my` (lerp 0.08). Use it as parallax driver for all 4 layers (back to front, magnitude scales with z).
- Additional micro-interaction: each constellation's rotation gets a tiny `±0.03 rad` offset proportional to `(mx,my)` and the constellation's screen position relative to center → whole field "tilts" subtly with the cursor. No per-edge mouse hit-testing (too costly + would break 30fps budget).

**Performance & budget:**
- Keep `FRAME_MS = 1000/30` and `dpr ≤ 1.5`.
- Stars rendered as `fillRect(x,y,1,1)` or `arc` for mid layer; do **not** use radial gradients per-star for the background layers (too expensive at 220+110 count). Reserve radial gradients only for the 12*~7 ≈ 84 zodiac vertex halos.
- Pre-seed starfields on resize (same pattern as today).
- Twinkle uses one `sin` per star per frame — ~360 sin calls/frame, negligible.

---

## Guardrails (unchanged, re-verify after edit)

- `scripts/check-home-theme-isolation.ts` still passes (no scene-token leaks).
- Both files keep `lightweight: true` semantics (no change required — flag lives in `registry.ts` which we don't touch).
- `prefers-reduced-motion` honoured by SceneHost upstream — internal loops still respect `pausedRef`.
- WebGL fallback unaffected (both scenes are Canvas2D).
- Vitest suite untouched; visual E2E baselines for these two scenes will need refresh after merge (call out, do not regenerate in this plan).

## Files touched

- `src/components/home/scenes/ObsidianInk.tsx` — rewrite blot renderer; keep paper texture + lifecycle.
- `src/components/home/scenes/DigitalConstellation.tsx` — add multi-layer starfield, time-based edge pulsing, expanded parallax; keep zodiac data + placement.

## QA checklist

1. `bun run check:home-isolation` → pass.
2. Manual `/` with each of the two scenes selected:
   - Obsidian: no visible contour rings; overlapping blots clearly darker than singles; rim looks fibrous, not polygonal; paper grain visible.
   - Zodiac: pointer move produces visible depth shift; star layers twinkle independently; zodiac edges breathe at different cadences; periodic full pulse still fires.
3. Toggle `prefers-reduced-motion` (DevTools rendering tab) → animation freezes (SceneHost responsibility, just verify nothing regressed).
4. DevTools Performance: confirm both scenes stay ≤ ~33ms frame time on a mid-tier laptop (30fps cap for Zodiac, 18fps for Obsidian).
5. Switch to `/note/test` → confirm no scene tokens or canvases leak.