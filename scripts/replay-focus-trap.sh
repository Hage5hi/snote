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

DEBUG_SELECTORS=0
INPUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --debug-selectors) DEBUG_SELECTORS=1; shift;;
    -h|--help)
      echo "Usage: $0 [--debug-selectors] <focus-trap-escape-*.json | *.html>"; exit 0;;
    *) INPUT="$1"; shift;;
  esac
done

if [ -z "$INPUT" ] || [ ! -f "$INPUT" ]; then
  echo "Usage: $0 [--debug-selectors] <focus-trap-escape-*.json | *.html>" >&2
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

# Fail fast on malformed focus-trap-escape JSON so the replay harness
# never boots against a broken payload. Prints exact JSON pointer, field
# and value snippet for each schema violation.
if [ -f "$JSON" ]; then
  node -e '
    const fs = require("fs");
    const snip = (v) => { let s; try { s = JSON.stringify(v); } catch { s = String(v); } return s == null ? "" : (s.length > 80 ? s.slice(0,79)+"…" : s); };
    let p;
    try { p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { console.error("✗ parse error: " + e.message); process.exit(4); }
    const errs = [];
    if (!p || typeof p !== "object" || Array.isArray(p)) errs.push({ pointer: "", field: "payload", message: "expected object", value: snip(p) });
    else {
      if (!Array.isArray(p.focusHistory)) errs.push({ pointer: "/focusHistory", field: "focusHistory", message: "required array", value: snip(p.focusHistory) });
      else p.focusHistory.forEach((e, i) => {
        if (!e || typeof e !== "object") errs.push({ pointer: `/focusHistory/${i}`, field: `focusHistory[${i}]`, message: "expected object", value: snip(e) });
        else if (typeof e.event !== "string") errs.push({ pointer: `/focusHistory/${i}/event`, field: "event", message: "expected string", value: snip(e.event) });
      });
    }
    if (errs.length) {
      console.error("✗ malformed focus-trap-escape JSON:");
      for (const e of errs) console.error(`  - ${e.pointer || "/"} [${e.field}]: ${e.message} (got ${e.value})`);
      process.exit(4);
    }
  ' "$JSON"
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
  // %DEBUG_SELECTORS% is replaced by the shell after the heredoc.
  const DEBUG_SELECTORS = /*__DEBUG_SELECTORS__*/ false;
  function matchActive(doc, active) {
    const q = (s) => { try { return doc.querySelector(s); } catch { return null; } };
    const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g,'\\"'));
    if (active.id) { const el = q(`#${esc(active.id)}`); if (el) return { el, path: 'id' }; }
    if (active.dataTestid) { const el = q(`[data-testid="${esc(active.dataTestid)}"]`); if (el) return { el, path: 'data-testid' }; }
    if (active.ariaLabel) { const el = q(`[aria-label="${esc(active.ariaLabel)}"]`); if (el) return { el, path: 'aria-label' }; }
    if (active.name) { const el = q(`[name="${esc(active.name)}"]`); if (el) return { el, path: 'name' }; }
    if (active.role && active.text) {
      for (const n of doc.querySelectorAll(`[role="${esc(active.role)}"]`)) {
        if ((n.textContent||'').trim().startsWith(active.text)) return { el: n, path: 'role+text' };
      }
    }
    if (active.outerHTML) {
      const needle = active.outerHTML.slice(0, 80);
      for (const n of doc.querySelectorAll(active.tag || '*')) {
        if (n.outerHTML.startsWith(needle)) return { el: n, path: 'outerHTML-prefix' };
      }
    }
    return { el: null, path: 'none' };
  }

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
        try {
          const doc = dom.contentDocument;
          if (!doc || !active) return;
          doc.querySelectorAll('[data-ft-highlight]').forEach(n=>{n.removeAttribute('data-ft-highlight');n.style.outline='';});
          const { el: found, path } = matchActive(doc, active);
          if (DEBUG_SELECTORS) {
            // Log which stable-selector path matched so on-call can see
            // why an element did (or did not) get highlighted.
            console.log(`[replay] step ${i} event=${e.event} matched via: ${path}`, active);
          }
          if (found) {
            found.setAttribute('data-ft-highlight', '1');
            found.style.outline = '3px solid #ff9800';
            found.scrollIntoView({block:'center'});
          }
        } catch { /* cross-origin fallback */ }
      });
      tl.appendChild(li);
    });
  });
</script>
HTML

if [ "$DEBUG_SELECTORS" = "1" ]; then
  sed -i.bak 's|/\*__DEBUG_SELECTORS__\*/ false|/*__DEBUG_SELECTORS__*/ true|' "$OUT/index.html"
  rm -f "$OUT/index.html.bak"
  echo "▶ Debug mode ON — open devtools console to see selector paths."
fi


URL="file://$OUT/index.html"
echo "▶ Wrote replay harness: $URL"
if   command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v open      >/dev/null; then open      "$URL" || true
else echo "  (open manually)"; fi
