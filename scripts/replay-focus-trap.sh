#!/usr/bin/env bash
# Offline replay of a captured focus-trap DOM state. Copies the HTML
# snapshot (and its screenshot, if present) next to a tiny harness page
# under /tmp/focus-trap-replay/, then opens the harness in the default
# browser so you can poke at the frozen DOM in devtools.
#
# Usage:
#   ./scripts/replay-focus-trap.sh <focus-trap-escape-*.json | *.html>
#
# The harness is intentionally minimal: it iframes the snapshot so
# devtools shows the exact DOM, and shows the screenshot side-by-side.
set -euo pipefail

INPUT="${1:-}"
if [ -z "$INPUT" ] || [ ! -f "$INPUT" ]; then
  echo "Usage: $0 <focus-trap-escape-*.json | *.html>" >&2
  exit 2
fi

DIR="$(cd "$(dirname "$INPUT")" && pwd)"
BASE="$(basename "$INPUT" .json)"
BASE="${BASE%.html}"

HTML="$DIR/${BASE}.html"
PNG="$DIR/${BASE}.png"
JSON="$DIR/${BASE}.json"

if [ ! -f "$HTML" ]; then
  echo "Missing HTML snapshot: $HTML" >&2
  exit 3
fi

OUT="/tmp/focus-trap-replay"
mkdir -p "$OUT"
cp "$HTML" "$OUT/snapshot.html"
[ -f "$PNG" ]  && cp "$PNG"  "$OUT/snapshot.png"
[ -f "$JSON" ] && cp "$JSON" "$OUT/snapshot.json"

cat > "$OUT/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>Focus-trap replay</title>
<style>
  body{margin:0;font:14px system-ui;display:grid;grid-template-columns:1fr 1fr;height:100vh}
  section{overflow:auto;border-right:1px solid #ccc;padding:8px}
  iframe{width:100%;height:80vh;border:1px solid #999}
  img{max-width:100%;border:1px solid #999}
  pre{white-space:pre-wrap;font-size:12px;background:#f5f5f5;padding:6px}
</style>
<section>
  <h3>DOM snapshot</h3>
  <iframe src="snapshot.html" sandbox="allow-same-origin"></iframe>
</section>
<section>
  <h3>Screenshot</h3>
  <img src="snapshot.png" onerror="this.replaceWith(Object.assign(document.createElement('em'),{textContent:'no screenshot'}))">
  <h3>JSON payload</h3>
  <pre id="j">loading…</pre>
  <script>
    fetch('snapshot.json').then(r=>r.ok?r.text():'no json').then(t=>document.getElementById('j').textContent=t);
  </script>
</section>
HTML

URL="file://$OUT/index.html"
echo "▶ Wrote replay harness: $URL"
if   command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v open      >/dev/null; then open      "$URL" || true
else echo "  (open manually)"; fi
