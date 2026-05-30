# Plan: Balance + accurize all 12 zodiac asterisms

## Scope

Edit a **single file**: `src/components/home/scenes/DigitalConstellation.tsx`.

Only the `ZODIAC_RAW` array (lines ~32–107) is touched — specifically the `pts` and `edges` of each entry. Everything else stays as-is:
- 4×3 / 3×4 grid layout, centroid recentering, `cellMin * 0.32` scale
- Unicode glyph watermarks, mono labels (name + date range)
- 30fps cap, sine-wave breathing, per-edge twinkle, halo render
- Background dust/stars layers

Authoring space stays roughly `[-0.5, 0.5]` on both axes (runtime recenters on centroid, so small drift is forgiving).

## Per-constellation target shapes & star counts

| Sign | Shape brief | Stars |
|---|---|---|
| ARI | Bent/crooked horn line | 5 |
| TAU | Hyades **V** (face) + 2 long upward horn lines to Elnath / ζ Tau | 10 |
| GEM | Two stick figures (head, torso, joined-hand arms, 2 legs each) | 14 |
| CNC | Central small box with branching legs (inverted-Y feel) | 7 |
| LEO | Sickle (backward `?`) on left, joined to hindquarters triangle ending at Denebola | 11 |
| VIR | Boxy 4-point torso, 2 arm branches, 2 leg branches, long line down to Spica | 13 |
| LIB | Triangle resting on a wider base line (scale/diamond) | 7 |
| SCO | Top claws fan (3 stars) → bent body chain → curling tail + stinger | 15 |
| SGR | Classic **Teapot** (body quad, handle, spout, lid) | 8 |
| CAP | Large distorted arrowhead / triangle (sea-goat) | 11 |
| AQR | Small jar polygon + 2 parallel zig-zag wave streams | 13 |
| PSC | Two circlets (4-pt + 5-pt polygons) joined by a wide **V** cord | 15 |

All counts land inside the user's 8–16 target band except ARI (5, ram is canonically tiny) and CNC (7, crab is canonically sparse) — both standard astronomical figures. Confirm in clarifying note if these need padding to 8.

## Authoring rules

1. Coords in `[-0.5, 0.5]`; centroid auto-recenter handles balance drift.
2. Edges are index pairs into `pts`, ordered for stroke-friendly twinkle sequencing.
3. Keep each figure roughly square so 4×3 and 3×4 cell aspects both look right.
4. No new helpers, no API changes, no edits outside the `ZODIAC_RAW` literal.

## Verification

1. TypeScript build (auto-run by harness) — the change is data-only inside a typed literal.
2. Visual QA in preview at user's viewport (1169×883): open `/note/...`, confirm each cell shows the intended asterism and no vertex clips its cell.
3. No e2e baseline refresh needed — repo has no committed visual snapshots for `digital-constellation`; existing `pixelDiffRatio: 0.02` continues to apply.

## Out of scope (explicitly NOT touching)

- Grid math, `resize()`, static-layer caching, watermarks, labels
- Star/dust/halo rendering, breathing/twinkle math, FPS cap
- i18n strings, scene registry entry, scene metadata
- Any file other than `src/components/home/scenes/DigitalConstellation.tsx`
