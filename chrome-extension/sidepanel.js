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

// Two-phase load watchdog. `LOAD_TIMEOUT_MS` waits for a real
// `syrin:ready` handshake from the app (posted from src/lib/ext-context.ts).
// If it doesn't arrive, we retry once with a cache-buster before falling
// back — most transient failures (cold SW, Cloudflare bot-check) recover
// on the retry, so the fallback screen means something is actually wrong.
const LOAD_TIMEOUT_MS = 12000;
const MAX_RETRIES = 1;

const iframe = document.getElementById("app");
const loader = document.getElementById("loader");
const fallback = document.getElementById("fallback");
const openTab = document.getElementById("open-tab");
const retryBtn = document.getElementById("retry-load");
const diagUrl = document.getElementById("diag-url");
const diagHead = document.getElementById("diag-head");
const diagReady = document.getElementById("diag-ready");
const diagRetries = document.getElementById("diag-retries");
const diagCopy = document.getElementById("diag-copy");
const debugBar = document.getElementById("debug-bar");
const debugLast = document.getElementById("debug-last");
const debugLog = document.getElementById("debug-log");
const debugCopy = document.getElementById("debug-copy");
const debugExport = document.getElementById("debug-export");
const debugRedact = document.getElementById("debug-redact");
const debugClear = document.getElementById("debug-clear");

let ready = false;
let iframeLoaded = false;
let retryCount = 0;
let watchdogTimer = null;
let lastSavedSlug = "";
let currentSrc = "";
let cachedSettings = null;
let readyBuildId = null;

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
  const { payload, redact } = buildExportPayload();
  const text = redact
    ? JSON.stringify(payload, null, 2)
    : Array.from(debugLog.children).map((li) => li.textContent).join("\n");
  navigator.clipboard?.writeText(text).catch(() => {});
});
debugClear?.addEventListener("click", () => {
  if (debugLog) debugLog.innerHTML = "";
});

const REDACT_KEY = "debugRedact";
chrome.storage?.local?.get?.({ [REDACT_KEY]: false }, (s) => {
  if (debugRedact) debugRedact.checked = !!s[REDACT_KEY];
});
debugRedact?.addEventListener("change", () => {
  chrome.storage?.local?.set?.({ [REDACT_KEY]: !!debugRedact.checked });
});

debugExport?.addEventListener("click", () => {
  try {
    const { payload, redact, exportedAt } = buildExportPayload();
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
  if (!data || typeof data !== "object") return;

  // App-mounted handshake — the real signal that the app is running,
  // not just that the iframe network request completed.
  if (data.type === "syrin:ready") {
    if (!ready) {
      ready = true;
      readyBuildId = typeof data.buildId === "string" ? data.buildId : null;
      dlog("ready received", `buildId=${readyBuildId ?? "?"}`);
      hideLoaderAndFallback();
      clearWatchdog();
    }
    return;
  }

  if (data.type === "syrin:slug" && isValidSlug(data.slug)) {
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
  }
});

function loadDefaultsWithFallback(cb) {
  const defaults = { openMode: "home", defaultSlug: "", lastSlug: "", debug: false };
  try {
    chrome.storage.sync.get(defaults, (settings) => {
      if (chrome.runtime.lastError) {
        // Enterprise policy or corrupt sync — fall back to local storage
        // so users don't get a silently-broken panel.
        dlog("storage.sync unavailable, using local", chrome.runtime.lastError.message);
        chrome.storage.local.get(defaults, (local) => cb(local || defaults));
        return;
      }
      cb(settings);
    });
  } catch (err) {
    dlog("storage.sync threw, using defaults", String(err?.message || err));
    cb(defaults);
  }
}

function hideLoaderAndFallback() {
  fallback.hidden = true;
  iframe.hidden = false;
  loader.classList.add("hidden");
  setTimeout(() => loader.remove?.(), 250);
}

function clearWatchdog() {
  if (watchdogTimer != null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function armWatchdog() {
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    if (ready) return;
    if (retryCount < MAX_RETRIES) {
      retryCount += 1;
      dlog("watchdog fired, retrying", `attempt=${retryCount}`);
      loadIframe(cachedSettings, /*isRetry*/ true);
    } else {
      dlog("watchdog fired, showing fallback", `retries=${retryCount}`);
      showFallback();
    }
  }, LOAD_TIMEOUT_MS);
}

function loadIframe(settings, isRetry = false) {
  ready = false;
  iframeLoaded = false;
  const base = buildSrc({ ...settings, appOrigin: APP_ORIGIN });
  currentSrc = isRetry
    ? `${base}${base.includes("?") ? "&" : "?"}retry=${retryCount}&_=${Date.now()}`
    : base;
  dlog(isRetry ? "reloading" : "loading", currentSrc);
  iframe.src = currentSrc;
  armWatchdog();
}

async function probeAppOrigin() {
  try {
    const res = await fetch(`${APP_ORIGIN}/version.json?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
    });
    return `${res.status} ${res.ok ? "ok" : res.statusText || "not ok"}`;
  } catch (err) {
    return `error: ${err?.message || err}`;
  }
}

async function showFallback() {
  loader.hidden = true;
  iframe.hidden = true;
  fallback.hidden = false;
  if (diagUrl) diagUrl.textContent = currentSrc || "(none)";
  if (diagRetries) diagRetries.textContent = String(retryCount);
  if (diagReady) diagReady.textContent = ready ? "received" : "not received";
  if (diagHead) diagHead.textContent = "checking…";
  const head = await probeAppOrigin();
  if (diagHead) diagHead.textContent = head;
  dlog("fallback shown", `head=${head}`);
}

diagCopy?.addEventListener("click", () => {
  const diag = {
    iframeSrc: currentSrc,
    retryCount,
    readyReceived: ready,
    readyBuildId,
    iframeLoaded,
    appReachable: diagHead?.textContent || "unknown",
    at: new Date().toISOString(),
    debugLines: snapshotDebugLog(),
  };
  navigator.clipboard?.writeText(JSON.stringify(diag, null, 2)).catch(() => {});
});

retryBtn?.addEventListener("click", () => {
  retryCount = 0;
  fallback.hidden = true;
  iframe.hidden = false;
  loader.classList.remove("hidden");
  loader.hidden = false;
  loadIframe(cachedSettings, /*isRetry*/ true);
});

// Read user settings, then load the iframe.
loadDefaultsWithFallback((settings) => {
  cachedSettings = settings;
  setDebug(settings.debug);
  updateDebugBarVisibility();
  lastSavedSlug = settings.lastSlug || "";
  updateDebugLast(lastSavedSlug);
  loadIframe(settings, /*isRetry*/ false);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.debug) {
    setDebug(changes.debug.newValue);
    updateDebugBarVisibility();
  }
  if (changes.lastSlug) updateDebugLast(changes.lastSlug.newValue);
});

iframe.addEventListener("load", () => {
  iframeLoaded = true;
  dlog("iframe load event");
  // Do NOT hide the loader yet — wait for `syrin:ready` from the app so
  // we don't declare success on a blank/error page. The watchdog will
  // cover apps that don't post the handshake (older builds, non-app URL).
});

openTab.addEventListener("click", () => {
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: APP_ORIGIN });
  } else {
    window.open(APP_ORIGIN, "_blank", "noopener");
  }
});

void badgeForMode;
