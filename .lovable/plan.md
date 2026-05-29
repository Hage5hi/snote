
# Zodiac Map — full rewrite of `DigitalConstellation.tsx`

The current scene drifts the whole sky horizontally, which causes constellation clipping and reads as a cheap pan. Topologies are also approximate and there are no glyph watermarks or date labels. Rewrite the scene from scratch around a fixed responsive grid.

Scope: **only** `src/components/home/scenes/DigitalConstellation.tsx`. No registry, i18n, CSS, or other scene changes. 30fps throttle and `lightweight: true` are preserved.

## 1. Layout — fixed responsive grid, zero clipping

- Drop all global horizontal drift (`DRIFT_*` constants, `wrapX`, `zDrift`, double-draw seam logic). Zodiacs are pinned.
- Compute grid orientation from aspect ratio every resize:
  - `w / h >= 1` (landscape) → `cols=4, rows=3`
  - else (portrait) → `cols=3, rows=4`
- Cell rect: `cellW = w / cols`, `cellH = h / rows`. Each zodiac gets cell index `i` → `(col, row)` → center `(cx, cy) = ((col+0.5)*cellW, (row+0.5)*cellH)`.
- Per-constellation scale derived from cell size, NOT viewport: `scl = min(cellW, cellH) * 0.32` so the bounding box (points are normalised to roughly [-0.5, 0.5]) always fits inside its cell with padding. No rotation jitter (rotation could push points outside the cell — drop `rot`).
- Background dust and far/mid stars keep a very slow autonomous drift (kept subtle, wrap with modulo). Only background layers drift; the 12 zodiacs are fixed.

## 2. Asynchronous breathing

- Each zodiac gets a deterministic random phase `phase_i = (i * 1.7) % (2π)` and a slightly varied period (e.g. `period_i = 6 + (i % 5)` seconds) so the 12 fade in/out organically rather than in lockstep.
- `breath_i = 0.2 + 0.6 * (0.5 + 0.5 * sin(t * 2π/period_i + phase_i))` → oscillates in [0.2, 0.8] as specified.
- `breath_i` multiplies: edge alpha, vertex star alpha, glyph watermark alpha (scaled down), and label alpha. Stars retain a small independent micro-twinkle layered on top, but the dominant cycle is the constellation-level breath.

## 3. Accurate topologies (hardcoded)

Replace the current `ZODIAC` array with hand-authored star positions matching the real night-sky shapes (normalised to roughly [-0.5, 0.5] on both axes, oriented as conventionally drawn in star charts). For each: list of `(x, y)` star points and an `edges` array of vertex index pairs forming the canonical stick figure. Sources: IAU constellation line figures.

The 12 constellations and approximate star count to author:
- ARI (Aries) — 4 stars, 3 edges (hooked line)
- TAU (Taurus) — 7 stars, V-shape head (Hyades) + horn tips
- GEM (Gemini) — 8 stars, twin stick figures Castor/Pollux
- CNC (Cancer) — 5 stars, faint Y/inverted-Y
- LEO (Leo) — 9 stars, sickle + triangle hindquarters
- VIR (Virgo) — 8 stars, Y-shape with Spica
- LIB (Libra) — 4 stars, kite
- SCO (Scorpio) — 11 stars, S-curve with claws + stinger
- SGR (Sagittarius) — 8 stars, "teapot" asterism
- CAP (Capricorn) — 6 stars, triangle/arrowhead
- AQR (Aquarius) — 7 stars, water-jar pattern
- PSC (Pisces) — 9 stars, two fish joined by V

Each set independently centroid-adjusted so the average of points is `(0, 0)` and max extent ≤ 0.5, guaranteeing the figure draws centered inside its cell.

## 4. Glyph watermark + dual-line label

For each cell:

- **Watermark:** `ctx.fillText(glyph, cx, cy)` with `textAlign="center"`, `textBaseline="middle"`, font `${Math.round(min(cellW,cellH)*0.45)}px serif` (≈80–120px on a 1080p screen, scales with cell). Color `rgba(180, 200, 240, 0.05 * (0.5 + breath))` so it pulses faintly. Drawn BEFORE the edges/stars (behind them).
- **Stars + edges** drawn on top using existing halo + line technique, but alpha gated by `breath_i`.
- **Label (two lines)** drawn below the constellation bounding box:
  - Line 1: abbreviation (e.g. `CAP`) — font `10px ui-monospace, ...`, `rgba(170,200,240, 0.35*breath)`
  - Line 2: date range (e.g. `22/12 - 19/1`) — font `9px ui-monospace, ...`, `rgba(170,200,240, 0.25*breath)`
  - Positioned at `(cx, cy + scl*0.55)` and `(cx, cy + scl*0.55 + 12)`, `textAlign="center"`, `textBaseline="top"`.
- Glyphs and date ranges per the data dictionary in the request. Hardcoded constant table keyed in display order ARI → PSC.

## 5. Performance + isolation

- Keep `FRAME_MS = 1000/30` 30fps cap.
- Background dust drift unchanged in spirit but slower (e.g. 1 px/sec) and ONLY applied to dust + far/mid stars (no zodiac drift).
- No pointer listeners. No DOM listeners beyond the existing `ResizeObserver`.
- All allocations done in `resize()` / module scope. Tick allocates nothing per frame except the gradient (kept).
- File header comment updated to describe: "Fixed 4×3 (or 3×4) grid of anchored zodiacs, async breathing, glyph watermarks, mono labels."

## Verification

- Visual at `/` with scene = Zodiac Map across desktop landscape and a tall mobile viewport: 12 constellations visible, none clipped, glyph + label centered, breathing async.
- `bun run check:home-theme-isolation` still passes (no CSS or token changes).
- `prefers-reduced-motion`: existing `paused` prop path unchanged.

## Out of scope

Registry id, i18n strings, color tokens, other scenes, tests.
