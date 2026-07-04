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
  body{margin:0;font:14px system-ui;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr auto;height:100vh}
  section{overflow:auto;border:1px solid #ccc;padding:8px}
  iframe{width:100%;height:70vh;border:1px solid #999}
  img{max-width:100%;border:1px solid #999}
  pre{white-space:pre-wrap;font-size:12px;background:#f5f5f5;padding:6px;max-height:30vh;overflow:auto}
  #timeline{grid-column:1/3;max-height:35vh;overflow:auto;border-top:2px solid #333}
  #timeline ol{margin:0;padding:4px 24px;font-family:ui-monospace,monospace;font-size:12px}
  #timeline li{padding:2px 4px;cursor:pointer;border-radius:3px}
  #timeline li:hover{background:#eef}
  #timeline li.active{background:#ffd54f;font-weight:700}
  #timeline li.escape{color:#b00}
  .badge{display:inline-block;padding:0 6px;margin-right:6px;border-radius:3px;background:#333;color:#fff;font-size:11px}
  .badge.in{background:#2e7d32}
  .badge.out{background:#b00}
</style>
<section>
  <h3>DOM snapshot</h3>
  <iframe id="dom" src="snapshot.html" sandbox="allow-same-origin"></iframe>
  <h3>Current step outerHTML</h3>
  <pre id="step">click a timeline entry…</pre>
</section>
<section>
  <h3>Screenshot</h3>
  <img src="snapshot.png" onerror="this.replaceWith(Object.assign(document.createElement('em'),{textContent:'no screenshot'}))">
  <h3>JSON payload</h3>
  <pre id="j">loading…</pre>
</section>
<section id="timeline">
  <strong>Focus transition timeline</strong> — click a step to highlight activeElement in the DOM snapshot.
  <ol id="tl"></ol>
</section>
<script>
  fetch('snapshot.json').then(r=>r.ok?r.json():null).then(payload=>{
    document.getElementById('j').textContent = payload ? JSON.stringify(payload,null,2) : 'no json';
    const hist = (payload && payload.focusHistory) || [];
    const tl = document.getElementById('tl');
    const step = document.getElementById('step');
    const dom = document.getElementById('dom');

    hist.forEach((e, i) => {
      const snap = e.snapshot || e.after || e.before || {};
      const active = snap.active || snap;
      const inside = active && active.insideDialog;
      const li = document.createElement('li');
      const badge = inside === false ? '<span class="badge out">OUT</span>' : inside ? '<span class="badge in">IN</span>' : '<span class="badge">?</span>';
      const label = (active && (active.ariaLabel || active.text || active.tag)) || '(no active)';
      li.innerHTML = `${badge}<code>${e.event}</code> @${(e.perf||0).toFixed(1)}ms — ${label}`;
      if (inside === false) li.classList.add('escape');
      li.addEventListener('click', () => {
        document.querySelectorAll('#tl li.active').forEach(n=>n.classList.remove('active'));
        li.classList.add('active');
        step.textContent = (active && active.outerHTML) || JSON.stringify(active, null, 2);
        // Best-effort DOM highlight: mark any element inside the iframe
        // whose outerHTML prefix matches the recorded activeElement.
        try {
          const doc = dom.contentDocument;
          if (!doc || !active || !active.outerHTML) return;
          doc.querySelectorAll('[data-ft-highlight]').forEach(n=>n.removeAttribute('data-ft-highlight'));
          const needle = active.outerHTML.slice(0, 80);
          const all = doc.querySelectorAll(active.tag || '*');
          for (const n of all) {
            if (n.outerHTML.startsWith(needle)) {
              n.setAttribute('data-ft-highlight', '1');
              n.style.outline = '3px solid #ff9800';
              n.scrollIntoView({block:'center'});
              break;
            }
          }
        } catch { /* cross-origin fallback */ }
      });
      tl.appendChild(li);
    });
  });
</script>
HTML


URL="file://$OUT/index.html"
echo "▶ Wrote replay harness: $URL"
if   command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v open      >/dev/null; then open      "$URL" || true
else echo "  (open manually)"; fi
