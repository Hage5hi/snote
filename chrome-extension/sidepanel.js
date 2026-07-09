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
import {
  recordTelemetry,
  readTelemetry,
  clearTelemetry,
  isTelemetryEnabled,
  readTelemetryEnabledAsync,
} from "./lib/telemetry.js";
import { validateDiagnostics, DIAGNOSTICS_KIND, DIAGNOSTICS_SCHEMA_VERSION } from "./lib/diagnostics-schema.js";

const APP_ORIGIN = "https://note.syrin.online";

// Versioned handshake protocol. Bump when the message shape changes in a
// backwards-incompatible way. The app sends its supported version in
// `syrin:ready.protocol`; missing → v1 (compat for pre-1.3.2 apps).
const HANDSHAKE_PROTOCOL = 2;
const MIN_APP_PROTOCOL = 1;
const MAX_APP_PROTOCOL = 2;

// Two-phase load watchdog. Waits for a real `syrin:ready` handshake from
// the app. Retries once with cache-buster if it doesn't arrive, so most
// transient failures (cold SW, Cloudflare bot-check) recover silently.
const LOAD_TIMEOUT_MS = 12000;
const MAX_RETRIES = 1;
const MESSAGE_TIMELINE_MAX = 30;

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
const diagDownload = document.getElementById("diag-download");
const debugBar = document.getElementById("debug-bar");
const debugLast = document.getElementById("debug-last");
const debugLog = document.getElementById("debug-log");
const debugCopy = document.getElementById("debug-copy");
const debugExport = document.getElementById("debug-export");
const debugRedact = document.getElementById("debug-redact");
const debugClear = document.getElementById("debug-clear");
const diagTelemetryStatus = document.getElementById("diag-telemetry-status");
const diagTelemetryList = document.getElementById("diag-telemetry-list");
const diagTelemetryRefresh = document.getElementById("diag-telemetry-refresh");
const diagTelemetryClear = document.getElementById("diag-telemetry-clear");
const diagValidation = document.getElementById("diag-validation");

let ready = false;
let iframeLoaded = false;
let retryCount = 0;
let watchdogTimer = null;
let lastSavedSlug = "";
let currentSrc = "";
let cachedSettings = null;
let readyBuildId = null;
let readyAppProtocol = null;
let versionMismatchReason = null;
const messageTimeline = []; // {t, kind, detail}

function pushTimeline(kind, detail) {
  messageTimeline.push({ t: Date.now(), kind, detail: detail ?? null });
  while (messageTimeline.length > MESSAGE_TIMELINE_MAX) messageTimeline.shift();
}

function extensionVersion() {
  return (
    (chrome.runtime?.getManifest && chrome.runtime.getManifest().version) || "unknown"
  );
}

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

function buildExportPayload() {
  const exportedAt = new Date().toISOString();
  const raw = {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    extensionVersion: extensionVersion(),
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
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
    pushTimeline("origin-rejected", { origin: event.origin });
    dlog("origin rejected", event.origin);
    return;
  }
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "syrin:ready") {
    const appProtocol = Number.isFinite(data.protocol) ? data.protocol : 1;
    const buildId = typeof data.buildId === "string" ? data.buildId : null;
    const appVersion = typeof data.appVersion === "string" ? data.appVersion : null;
    pushTimeline("ready", { protocol: appProtocol, buildId, appVersion });

    if (appProtocol < MIN_APP_PROTOCOL || appProtocol > MAX_APP_PROTOCOL) {
      versionMismatchReason = `app protocol=${appProtocol} not in [${MIN_APP_PROTOCOL},${MAX_APP_PROTOCOL}] (ext=${HANDSHAKE_PROTOCOL})`;
      dlog("handshake version mismatch", versionMismatchReason);
      recordTelemetry("handshake-version-mismatch", {
        appBuildId: buildId,
        retryCount,
        detail: {
          appProtocol,
          extProtocol: HANDSHAKE_PROTOCOL,
          appVersion,
          extVersion: extensionVersion(),
        },
      });
      showFallback();
      clearWatchdog();
      return;
    }

    if (!ready) {
      ready = true;
      readyBuildId = buildId;
      readyAppProtocol = appProtocol;
      dlog("ready received", `buildId=${buildId ?? "?"} proto=${appProtocol}`);
      recordTelemetry("handshake-ok", {
        appBuildId: buildId,
        retryCount,
        detail: { appProtocol, extProtocol: HANDSHAKE_PROTOCOL },
      });
      hideLoaderAndFallback();
      clearWatchdog();
    }
    return;
  }

  if (data.type === "syrin:slug" && isValidSlug(data.slug)) {
    pushTimeline("slug", { len: data.slug.length });
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
        dlog("storage.sync unavailable, using local", chrome.runtime.lastError.message);
        recordTelemetry("storage-sync-fallback", {
          retryCount,
          detail: { reason: chrome.runtime.lastError.message },
        });
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
      recordTelemetry("retry-attempted", { retryCount, detail: { iframeLoaded } });
      loadIframe(cachedSettings, /*isRetry*/ true);
    } else {
      dlog("watchdog fired, showing fallback", `retries=${retryCount}`);
      recordTelemetry("fallback-shown", { retryCount, detail: { iframeLoaded } });
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
  pushTimeline(isRetry ? "iframe-retry" : "iframe-load", { retryCount });
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

async function verifyFrameAncestorsCsp() {
  try {
    const res = await fetch(`${APP_ORIGIN}/`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
    });
    const csp = res.headers.get("content-security-policy") || "";
    if (!csp) return { ok: false, csp: null, reason: "no CSP header" };
    if (!/frame-ancestors/i.test(csp)) return { ok: false, csp, reason: "missing frame-ancestors" };
    if (!/chrome-extension:\/\//i.test(csp)) {
      return { ok: false, csp, reason: "frame-ancestors excludes chrome-extension://" };
    }
    return { ok: true, csp, reason: null };
  } catch (err) {
    return { ok: false, csp: null, reason: `fetch failed: ${err?.message || err}` };
  }
}

async function showFallback() {
  loader.hidden = true;
  iframe.hidden = true;
  fallback.hidden = false;
  if (diagUrl) diagUrl.textContent = currentSrc || "(none)";
  if (diagRetries) diagRetries.textContent = String(retryCount);
  if (diagReady) {
    diagReady.textContent = versionMismatchReason
      ? `mismatch: ${versionMismatchReason}`
      : ready
      ? "received"
      : "not received";
  }
  if (diagHead) diagHead.textContent = "checking…";
  const head = await probeAppOrigin();
  if (diagHead) diagHead.textContent = head;
  dlog("fallback shown", `head=${head}`);
}

async function buildDiagnosticsBundle() {
  const csp = await verifyFrameAncestorsCsp();
  const telemetry = await readTelemetry();
  return {
    kind: "syrin-note-sidepanel-diagnostics",
    schemaVersion: 1,
    at: new Date().toISOString(),
    extensionVersion: extensionVersion(),
    handshake: {
      extensionProtocol: HANDSHAKE_PROTOCOL,
      appProtocol: readyAppProtocol,
      appBuildId: readyBuildId,
      ready,
      versionMismatch: versionMismatchReason,
    },
    load: {
      iframeSrc: currentSrc,
      iframeLoaded,
      retryCount,
      appReachable: diagHead?.textContent || "unknown",
    },
    cspFrameAncestors: csp,
    messageTimeline: messageTimeline.slice(),
    telemetry,
    debugLines: snapshotDebugLog(),
  };
}

diagCopy?.addEventListener("click", async () => {
  const bundle = await buildDiagnosticsBundle();
  navigator.clipboard?.writeText(JSON.stringify(bundle, null, 2)).catch(() => {});
});

diagDownload?.addEventListener("click", async () => {
  const bundle = await buildDiagnosticsBundle();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `syrin-note-diagnostics-${bundle.at.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

retryBtn?.addEventListener("click", () => {
  retryCount = 0;
  versionMismatchReason = null;
  fallback.hidden = true;
  iframe.hidden = false;
  loader.classList.remove("hidden");
  loader.hidden = false;
  loadIframe(cachedSettings, /*isRetry*/ true);
});

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
  pushTimeline("iframe-load-event", null);
  dlog("iframe load event");
});

openTab.addEventListener("click", () => {
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: APP_ORIGIN });
  } else {
    window.open(APP_ORIGIN, "_blank", "noopener");
  }
});

void badgeForMode;
