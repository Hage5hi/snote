#!/usr/bin/env bash
# Build Chrome Web Store promotional assets from the master watercolor "N"
# logo. Reproducible, no AI required. Output → /mnt/documents/chrome-store/.
#
# Usage: bash scripts/build-store-assets.sh
set -euo pipefail

SRC="chrome-extension/icons/source.png"
OUT="/mnt/documents/chrome-store"
BG="#F5F1E8"            # cream paper
INK="#1e3a8a"           # watercolor navy
INK_SOFT="#475569"      # body text

mkdir -p "$OUT"

MAGICK="nix run nixpkgs#imagemagick --"

# ---- Promo tiles (logo + typography on cream) ----

# Small tile 440x280 — N on left, "Syrin Note" on right
$MAGICK \
  -size 440x280 xc:"$BG" \
  \( "$SRC" -resize 220x220 \) -gravity west -geometry +20+0 -composite \
  -font Times-Bold -pointsize 38 -fill "$INK" \
  -gravity east -annotate +30+-18 "Syrin Note" \
  -font Helvetica -pointsize 14 -fill "$INK_SOFT" \
  -gravity east -annotate +30+30 "Side panel markdown" \
  "$OUT/tile-440x280.png"

# Marquee 1400x560 — N on left, big title + tagline on right
$MAGICK \
  -size 1400x560 xc:"$BG" \
  \( "$SRC" -resize 480x480 \) -gravity west -geometry +60+0 -composite \
  -font Times-Bold -pointsize 96 -fill "$INK" \
  -gravity west -annotate +580+-30 "Syrin Note" \
  -font Helvetica -pointsize 32 -fill "$INK_SOFT" \
  -gravity west -annotate +580+70 "Markdown notes in your side panel" \
  -font Helvetica -pointsize 22 -fill "$INK_SOFT" \
  -gravity west -annotate +580+130 "Press Alt+S anywhere in Chrome" \
  "$OUT/marquee-1400x560.png"

# Large promo 920x680 — N top-center, title + 3 bullets below
$MAGICK \
  -size 920x680 xc:"$BG" \
  \( "$SRC" -resize 280x280 \) -gravity north -geometry +0+30 -composite \
  -font Times-Bold -pointsize 56 -fill "$INK" \
  -gravity north -annotate +0+340 "Syrin Note — Side Panel" \
  -font Helvetica -pointsize 22 -fill "$INK_SOFT" \
  -gravity north -annotate +0+430 "• Write while you read" \
  -gravity north -annotate +0+470 "• Open with Alt+S" \
  -gravity north -annotate +0+510 "• Markdown + live preview" \
  "$OUT/promo-920x680.png"

# ---- Screenshots 1280x800 — placeholder cards with logo + caption.
# Real product shots should be captured by the user; these provide a
# branded fallback so the submission has 5 consistent slides.
make_screenshot() {
  local file="$1"
  local title="$2"
  local sub="$3"
  $MAGICK \
    -size 1280x800 xc:"$BG" \
    \( "$SRC" -resize 180x180 \) -gravity northwest -geometry +60+60 -composite \
    -font Times-Bold -pointsize 48 -fill "$INK" \
    -gravity northwest -annotate +280+110 "$title" \
    -font Helvetica -pointsize 22 -fill "$INK_SOFT" \
    -gravity northwest -annotate +280+180 "$sub" \
    -fill "#FFFFFF" -stroke "$INK_SOFT" -strokewidth 1 \
    -draw "roundrectangle 60,300 1220,740 12,12" \
    -font Helvetica -pointsize 18 -fill "$INK_SOFT" \
    -gravity south -annotate +0+30 "syrin-note.lovable.app  ·  Alt+S to open" \
    "$OUT/$file"
}

make_screenshot screenshot-1-hero.png        "Write while you read"     "Browse on the left, take notes on the right"
make_screenshot screenshot-2-settings.png    "Settings"                  "Homepage, specific note, or last opened"
make_screenshot screenshot-3-default-slug.png "Default slug"              "Badge S — panel always opens your journal"
make_screenshot screenshot-4-preview.png     "Markdown + live preview"  "GFM, code, math, mermaid — rendered as you type"
make_screenshot screenshot-5-lock.png        "Encrypted notes"           "AES-GCM, key never leaves your device"

echo "Built assets in $OUT:"
ls -la "$OUT"
