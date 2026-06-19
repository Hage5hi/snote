#!/usr/bin/env bash
# Build Chrome Web Store promotional assets from the master watercolor "N"
# logo. Reproducible, no AI required. Output → /mnt/documents/chrome-store/.
#
# Reads the extension version from chrome-extension/manifest.json and the
# latest changelog block from chrome-extension/STORE_LISTING.md so each
# rebuild stamps the marquee + a JSON sync manifest with the live build,
# keeping the store listing assets in sync with the shipped extension.
#
# Usage: bash scripts/build-store-assets.sh
set -euo pipefail

SRC="chrome-extension/icons/source.png"
OUT="${STORE_ASSETS_OUT:-/mnt/documents/chrome-store}"
BG="#F5F1E8"            # cream paper
INK="#1e3a8a"           # watercolor navy
INK_SOFT="#475569"      # body text

mkdir -p "$OUT"

MAGICK="nix run nixpkgs#imagemagick --"

# --- Read live version + changelog so assets reflect the shipped build. ---
VERSION="$(node -e "console.log(require('./chrome-extension/manifest.json').version)")"
# Pull the most recent "What's new — vX.Y.Z" block from STORE_LISTING.md.
CHANGELOG_HEADING="$(grep -m1 -E '^## What.s new' chrome-extension/STORE_LISTING.md || echo '## What'\''s new')"
CHANGELOG_VERSION="$(echo "$CHANGELOG_HEADING" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || echo "v$VERSION")"

echo "Building store assets for extension v$VERSION (changelog: $CHANGELOG_VERSION)"

# ---- Promo tiles (logo + typography on cream) ----

# Small tile 440x280 — N on left, "Syrin Note" on right
$MAGICK \
  -size 440x280 xc:"$BG" \
  \( "$SRC" -resize 220x220 \) -gravity west -geometry +20+0 -composite \
  -font Liberation-Serif-Bold -pointsize 38 -fill "$INK" \
  -gravity east -annotate +30+-18 "Syrin Note" \
  -font Liberation-Sans -pointsize 14 -fill "$INK_SOFT" \
  -gravity east -annotate +30+30 "Side panel markdown" \
  "$OUT/tile-440x280.png"

# Marquee 1400x560 — N on left, big title + tagline on right.
# Stamps the live extension version in the corner so reviewers can verify
# at a glance which build the asset belongs to.
$MAGICK \
  -size 1400x560 xc:"$BG" \
  \( "$SRC" -resize 480x480 \) -gravity west -geometry +60+0 -composite \
  -font Liberation-Serif-Bold -pointsize 96 -fill "$INK" \
  -gravity west -annotate +580+-30 "Syrin Note" \
  -font Liberation-Sans -pointsize 32 -fill "$INK_SOFT" \
  -gravity west -annotate +580+70 "Markdown notes in your side panel" \
  -font Liberation-Sans -pointsize 22 -fill "$INK_SOFT" \
  -gravity west -annotate +580+130 "Press Alt+S anywhere in Chrome" \
  -font Liberation-Sans -pointsize 16 -fill "$INK_SOFT" \
  -gravity southeast -annotate +24+20 "v$VERSION" \
  "$OUT/marquee-1400x560.png"

# Large promo 920x680 — N top-center, title + 3 bullets below
$MAGICK \
  -size 920x680 xc:"$BG" \
  \( "$SRC" -resize 280x280 \) -gravity north -geometry +0+30 -composite \
  -font Liberation-Serif-Bold -pointsize 56 -fill "$INK" \
  -gravity north -annotate +0+340 "Syrin Note — Side Panel" \
  -font Liberation-Sans -pointsize 22 -fill "$INK_SOFT" \
  -gravity north -annotate +0+430 "• Write while you read" \
  -gravity north -annotate +0+470 "• Open with Alt+S" \
  -gravity north -annotate +0+510 "• Markdown + live preview" \
  -font Liberation-Sans -pointsize 16 -fill "$INK_SOFT" \
  -gravity southeast -annotate +20+16 "v$VERSION" \
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
    -font Liberation-Serif-Bold -pointsize 48 -fill "$INK" \
    -gravity northwest -annotate +280+110 "$title" \
    -font Liberation-Sans -pointsize 22 -fill "$INK_SOFT" \
    -gravity northwest -annotate +280+180 "$sub" \
    -fill "#FFFFFF" -stroke "$INK_SOFT" -strokewidth 1 \
    -draw "roundrectangle 60,300 1220,740 12,12" \
    -font Liberation-Sans -pointsize 18 -fill "$INK_SOFT" \
    -gravity south -annotate +0+30 "syrin-note.lovable.app  ·  Alt+S to open  ·  v$VERSION" \
    "$OUT/$file"
}

make_screenshot screenshot-1-hero.png        "Write while you read"     "Browse on the left, take notes on the right"
make_screenshot screenshot-2-settings.png    "Settings"                  "Homepage, specific note, or last opened"
make_screenshot screenshot-3-default-slug.png "Default slug"              "Badge S — panel always opens your journal"
make_screenshot screenshot-4-preview.png     "Markdown + live preview"  "GFM, code, math, mermaid — rendered as you type"
make_screenshot screenshot-5-lock.png        "Encrypted notes"           "AES-GCM, key never leaves your device"

# ---- YouTube video thumbnail 1280x720 (matches unlisted demo) ----
$MAGICK \
  -size 1280x720 xc:"$BG" \
  \( "$SRC" -resize 360x360 \) -gravity west -geometry +80+0 -composite \
  -font Liberation-Serif-Bold -pointsize 78 -fill "$INK" \
  -gravity west -annotate +500+-40 "Syrin Note" \
  -font Liberation-Sans -pointsize 30 -fill "$INK_SOFT" \
  -gravity west -annotate +500+40 "Side panel demo" \
  -font Liberation-Sans -pointsize 22 -fill "$INK_SOFT" \
  -gravity west -annotate +500+90 "Alt+S · 20-second tour · v$VERSION" \
  -fill "$INK" -draw "circle 1100,560 1100,505" \
  -fill "#FFFFFF" -draw "polygon 1085,535 1085,585 1125,560" \
  "$OUT/video-thumbnail-1280x720.png"

# ---- Sync manifest: machine-readable record of which build the assets
# were generated from, so CI / store-upload tooling can verify the assets
# match the currently-shipped extension. ----
ASSETS_JSON="$OUT/assets-manifest.json"
{
  echo '{'
  echo "  \"extensionVersion\": \"$VERSION\","
  echo "  \"changelogVersion\": \"$CHANGELOG_VERSION\","
  echo "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo '  "files": ['
  first=1
  for f in "$OUT"/*.png; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    size="$(stat -c %s "$f" 2>/dev/null || stat -f %z "$f")"
    if [ $first -eq 0 ]; then echo ','; fi
    printf '    {"name": "%s", "size": %s}' "$name" "$size"
    first=0
  done
  echo ''
  echo '  ]'
  echo '}'
} > "$ASSETS_JSON"

echo "Built assets in $OUT:"
ls -la "$OUT"
echo "Sync manifest: $ASSETS_JSON"
