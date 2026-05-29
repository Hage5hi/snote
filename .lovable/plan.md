# Finalize Zodiac Constellation scene

## 1. Rename English label → "Zodiac Map"

Update only the English label string. Vietnamese ("Cung Hoàng Đạo") and other locales stay as-is per request.

- `src/i18n/index.ts` line 422: `"Zodiac Constellation"` → `"Zodiac Map"`
- Registry `id` (`digital-constellation`), filenames, and i18n key (`scene.digital_constellation.label`) remain unchanged — they're internal identifiers, not user-visible.

## 2. Remove all mouse parallax from `DigitalConstellation.tsx`

Delete:
- `targetMx`, `targetMy`, `mx`, `my` state
- `onPointer` handler and `window.addEventListener("pointermove", ...)` + matching `removeEventListener`
- All `mx`/`my`-derived offsets: `farOx/farOy`, `midOx/midOy`, `dustOx/dustOy`, `zOx/zOy`, and the per-constellation `tilt` term
- `PX_FAR`, `PX_MID`, `PX_DUST`, `PX_ZODIAC` constants

## 3. Celestial breathing + sidereal drift (autonomous, time-based)

All driven by `tSec = now * 0.001`. Throttled by existing `FRAME_MS = 1000 / 30` (30 fps cap preserved).

**Per-constellation breathing** — give each of the 12 zodiacs its own slow sine phase so they fade asynchronously:
```
conPhase   = i * 1.7
conBreath  = 0.5 + 0.5 * sin(tSec * 0.18 + conPhase)   // ~35 s period
```
Multiply edge `alpha`/`width` and star halo intensity by `(0.55 + 0.45 * conBreath)`. Keeps the existing per-edge micro-twinkle (`sin(tSec * 1.1 + phase)`) but layered under the slow constellation-level breath. Drop the discrete 8 s pulse system (`PULSE_INTERVAL_MS`, `PULSE_DUR_MS`, `pulse`, `nextPulse`, `pulseAmt`) — the smooth breath replaces it.

**Background star twinkle** — unchanged (already pure time-based sine, no mouse input).

**Sidereal drift** — apply a single global offset to every layer so the whole sky drifts as one rigid celestial sphere:
```
DRIFT_PX_PER_SEC = 4                   // ~1 screen-width / 6 min
driftX = (tSec * DRIFT_PX_PER_SEC) % w  // seamless wrap
```
- Far/mid stars: shift by `driftX * 0.4` (slowest, deepest layer)
- Dust: shift by `driftX * 0.7`
- Zodiacs: shift by `driftX * 1.0`

Wrap with `((x + driftX*k) % w + w) % w` so stars re-enter from the left without popping. For zodiac labels/edges that span beyond the wrap seam, draw each constellation twice (at `x` and `x - w`) only when its bounding box crosses the edge — cheap conditional, keeps the seam invisible.

Add a barely-perceptible vertical bob: `driftY = sin(tSec * 0.04) * 6` applied uniformly to all layers. Total motion budget stays under ~15 px, well below the previous parallax range, so nothing feels jittery.

## 4. Update file header comment

Replace the "Four parallax layers ... drift with the pointer" comment with a one-liner describing the new autonomous behaviour.

## Verification

- Visual check at `/` with scene set to Zodiac Map: confirm no pointer tracking, smooth drift, async constellation breathing
- Dropdown label no longer truncates in English
- `prefers-reduced-motion`: existing scene host already pauses via `paused` prop — no change needed
- `bun run check:home-theme-isolation` should still pass (no CSS changes)

## Out of scope

Other scenes, registry id changes, non-English i18n strings, CSS tokens, tests.
