import { buildSrc, badgeForMode } from "./lib/build-src.js";
import { isValidSlug } from "./lib/validate-slug.js";
import { dlog, isDebug, onDebugLog, setDebug, snapshotDebugLog } from "./lib/debug.js";
import { redactPayload } from "./lib/redact.js";
import {
  EXPORT_KIND,
  EXPORT_VERSION,
  expectedFilename,
  validateExport,
} from "./lib/export-schema.js";

const APP_ORIGIN = "https://note.syrin.online";

const iframe = document.getElementById("app");
const loader = document.getElementById("loader");
const fallback = document.getElementById("fallback");
const openTab = document.getElementById("open-tab");
const debugBar = document.getElementById("debug-bar");
const debugLast = document.getElementById("debug-last");
const debugLog = document.getElementById("debug-log");
const debugCopy = document.getElementById("debug-copy");
const debugExport = document.getElementById("debug-export");
const debugRedact = document.getElementById("debug-redact");
const debugClear = document.getElementById("debug-clear");

let loaded = false;
let lastSavedSlug = "";

function renderDebugLine(line) {
  if (!debugLog) return;
  const li = document.createElement("li");
  const ts = new Date(line.t).toISOString().slice(11, 19);
  li.textContent = `${ts}  ${line.msg}`;
  debugLog.prepend(li);
  while (debugLog.children.length > 50) debugLog.removeChild(debugLog.lastChild);
}

function updateDebugBarVisibility() {
  if (!debugBar) return;
  debugBar.hidden = !isDebug();
}

function updateDebugLast(slug) {
  if (debugLast) debugLast.textContent = `lastSlug: ${slug || "—"}`;
}

onDebugLog(renderDebugLine);

// Build the export payload — shared by download and copy paths so any
// redaction the user requested is applied identically across export
// surfaces (download .json, copy to clipboard).
function buildExportPayload() {
  const manifestVersion =
    (chrome.runtime?.getManifest && chrome.runtime.getManifest().version) || "unknown";
  const exportedAt = new Date().toISOString();
  const raw = {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    extensionVersion: manifestVersion,
    exportedAt,
    lastSlug: lastSavedSlug || null,
    iframeSrc: iframe?.src || null,
    lines: snapshotDebugLog(),
  };
  const redact = !!debugRedact?.checked;
  const payload = redact ? redactPayload(raw) : { ...raw, redacted: false };
  return { payload, redact, exportedAt };
}

debugCopy?.addEventListener("click", () => {
  // When redaction is on the copy path emits the same JSON shape as the
  // download so consumers see a single contract. When off, fall back to
  // the human-readable log view users expect from a "copy" button.
  const { payload, redact } = buildExportPayload();
  const text = redact
    ? JSON.stringify(payload, null, 2)
    : Array.from(debugLog.children).map((li) => li.textContent).join("\n");
  navigator.clipboard?.writeText(text).catch(() => {});
});
debugClear?.addEventListener("click", () => {
  if (debugLog) debugLog.innerHTML = "";
});

// Persist the redact toggle in chrome.storage.local so it survives panel
// reloads (and switching tabs that reopen the side panel).
const REDACT_KEY = "debugRedact";
chrome.storage?.local?.get?.({ [REDACT_KEY]: false }, (s) => {
  if (debugRedact) debugRedact.checked = !!s[REDACT_KEY];
});
debugRedact?.addEventListener("change", () => {
  chrome.storage?.local?.set?.({ [REDACT_KEY]: !!debugRedact.checked });
});




// One-click export: download the in-memory debug buffer as JSON.
// Captures ack/retry/origin-rejection/lastSlug entries dlog() recorded.
// When the "redact" checkbox is on, slugs/URLs/identifiers are masked
// (see lib/redact.js) before the file is written so the JSON is safe to
// share in bug reports. Both shapes are validated against the schema in
// lib/export-schema.js so consumers always get the same fields.
debugExport?.addEventListener("click", () => {
  try {
    const manifestVersion =
      (chrome.runtime?.getManifest && chrome.runtime.getManifest().version) || "unknown";
    const exportedAt = new Date().toISOString();
    const raw = {
      kind: EXPORT_KIND,
      version: EXPORT_VERSION,
      extensionVersion: manifestVersion,
      exportedAt,
      lastSlug: lastSavedSlug || null,
      iframeSrc: iframe?.src || null,
      lines: snapshotDebugLog(),
    };
    const redact = !!debugRedact?.checked;
    const payload = redact ? redactPayload(raw) : { ...raw, redacted: false };
    const verdict = validateExport(payload);
    if (!verdict.ok) {
      console.error("[syrin-note] export schema validation failed", verdict.errors);
      dlog("export blocked: schema invalid", verdict.errors.join("; "));
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = expectedFilename({ redacted: redact, isoTimestamp: exportedAt });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    dlog(`debug log exported${redact ? " (redacted)" : ""}`, payload.lines.length + " lines");
  } catch (err) {
    console.error("[syrin-note] debug export failed", err);
  }
});

// Listener attached BEFORE iframe.src to avoid races.
window.addEventListener("message", (event) => {
  if (event.origin !== APP_ORIGIN) {
    dlog("origin rejected", event.origin);
    return;
  }
  const data = event.data;
  if (
    !data ||
    typeof data !== "object" ||
    data.type !== "syrin:slug" ||
    !isValidSlug(data.slug)
  ) {
    return;
  }
  try {
    event.source?.postMessage({ type: "syrin:ack", slug: data.slug }, event.origin);
    dlog("ack sent", data.slug);
  } catch (err) {
    console.warn("[syrin-note] ack failed", err);
  }
  if (data.slug === lastSavedSlug) return;
  lastSavedSlug = data.slug;
  updateDebugLast(data.slug);
  try {
    chrome.storage.sync.set({ lastSlug: data.slug }, () => {
      if (chrome.runtime.lastError) {
        console.error("[syrin-note] storage.set lastSlug failed", chrome.runtime.lastError);
        dlog("storage write FAILED", chrome.runtime.lastError.message);
      } else {
        dlog("storage write ok", data.slug);
      }
    });
  } catch (err) {
    console.error("[syrin-note] failed to save lastSlug", err);
  }
});

// Read user settings, then load the iframe.
chrome.storage.sync.get(
  { openMode: "home", defaultSlug: "", lastSlug: "", debug: false },
  (settings) => {
    setDebug(settings.debug);
    updateDebugBarVisibility();
    lastSavedSlug = settings.lastSlug || "";
    updateDebugLast(lastSavedSlug);
    const src = buildSrc({ ...settings, appOrigin: APP_ORIGIN });
    dlog("loading", src);
    iframe.src = src;
  },
);

// React live to debug toggle from Settings.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.debug) {
    setDebug(changes.debug.newValue);
    updateDebugBarVisibility();
  }
  if (changes.lastSlug) updateDebugLast(changes.lastSlug.newValue);
});

iframe.addEventListener("load", () => {
  loaded = true;
  loader.classList.add("hidden");
  setTimeout(() => loader.remove(), 250);
});

setTimeout(() => {
  if (loaded) return;
  loader.hidden = true;
  iframe.hidden = true;
  fallback.hidden = false;
}, 8000);

openTab.addEventListener("click", () => {
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: APP_ORIGIN });
  } else {
    window.open(APP_ORIGIN, "_blank", "noopener");
  }
});

void badgeForMode;
