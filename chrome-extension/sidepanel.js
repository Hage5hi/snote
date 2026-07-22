import { buildSrc, badgeForMode } from "./lib/build-src.js";
import { isValidSlug } from "./lib/validate-slug.js";
import {
  clearDebugLog,
  dlog,
  isDebug,
  onDebugLog,
  setDebug,
  snapshotDebugLog,
} from "./lib/debug.js";
import {
  redactPayload,
  redactDiagnosticsBundle,
  redactTelemetryEventForDiagnostics,
  summarizeSlugForDiagnostics,
  summarizeUrlForDiagnostics,
} from "./lib/redact.js";
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
  readTelemetryEnabledAsync,
} from "./lib/telemetry.js";
import { validateDiagnostics, truncateTelemetryDetails, DIAGNOSTICS_KIND, DIAGNOSTICS_SCHEMA_VERSION } from "./lib/diagnostics-schema.js";
import {
  APP_ORIGIN,
  HANDSHAKE_PROTOCOL,
  MIN_APP_PROTOCOL,
  MAX_APP_PROTOCOL,
  DEFAULT_LOAD_TIMEOUT_MS,
  MAX_RETRIES,
} from "./lib/handshake-constants.js";
import { resolveFallbackReason } from "./lib/fallback-reason.js";
import { diagnosticsReasonType } from "./lib/diagnostics-reason-type.js";

// Two-phase load watchdog. Waits for a real `syrin:ready` handshake from
// the app. Retries once with cache-buster if it doesn't arrive, so most
// transient failures (cold SW, Cloudflare bot-check) recover silently.
// E2E can override via window.__SYRIN_TEST_TIMEOUT_MS for fast fallback specs.
const LOAD_TIMEOUT_MS =
  typeof window !== "undefined" && Number.isFinite(window.__SYRIN_TEST_TIMEOUT_MS)
    ? window.__SYRIN_TEST_TIMEOUT_MS
    : DEFAULT_LOAD_TIMEOUT_MS;
const MESSAGE_TIMELINE_MAX = 30;
const APP_VERSION_MAX_LENGTH = 64;
const EDIT_CAPABILITY_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_LOCAL_EDIT_CAPABILITIES = 50;

const iframe = document.getElementById("app");
const loader = document.getElementById("loader");
const fallback = document.getElementById("fallback");
const fallbackReason = document.getElementById("fallback-reason");
const fallbackCopyDiag = document.getElementById("fallback-copy-diag");
const openTab = document.getElementById("open-tab");
const retryBtn = document.getElementById("retry-load");
const diagUrl = document.getElementById("diag-url");
const diagHead = document.getElementById("diag-head");
const diagReady = document.getElementById("diag-ready");
const diagRetries = document.getElementById("diag-retries");
const diagCopy = document.getElementById("diag-copy");
const diagDownload = document.getElementById("diag-download");
const diagDetails = document.querySelector("details.diag");
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

function safeAppVersion(value) {
  if (typeof value !== "string" || value.length > APP_VERSION_MAX_LENGTH) {
    return "unknown";
  }
  return /^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(value)
    ? value
    : "unknown";
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
  if (debugLast) debugLast.textContent = `lastSlug: ${summarizeSlugForDiagnostics(slug)}`;
}

function persistEditCapability(slug, editCapability) {
  if (!isValidSlug(slug) || !EDIT_CAPABILITY_RE.test(editCapability || "")) return;
  try {
    chrome.storage.local.get({ editCapabilities: {} }, (stored) => {
      if (chrome.runtime.lastError) {
        dlog("local edit capability read failed");
        return;
      }
      const current = stored.editCapabilities && typeof stored.editCapabilities === "object"
        ? stored.editCapabilities
        : {};
      const next = { ...current };
      // Refresh insertion order so the bounded map evicts the least recently
      // received locator rather than a capability that was just updated.
      delete next[slug];
      next[slug] = editCapability;
      const keys = Object.keys(next);
      for (const oldSlug of keys.slice(0, Math.max(0, keys.length - MAX_LOCAL_EDIT_CAPABILITIES))) {
        delete next[oldSlug];
      }
      chrome.storage.local.set({ editCapabilities: next }, () => {
        if (chrome.runtime.lastError) dlog("local edit capability write failed");
      });
    });
  } catch {
    dlog("local edit capability storage unavailable");
  }
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
  const payload = redactPayload(raw);
  return { payload, redact: true, exportedAt };
}

debugCopy?.addEventListener("click", () => {
  const { payload, redact } = buildExportPayload();
  const text = JSON.stringify(payload, null, 2);
  navigator.clipboard?.writeText(text).catch(() => {});
});
debugClear?.addEventListener("click", () => {
  clearDebugLog();
  if (debugLog) debugLog.innerHTML = "";
});

if (debugRedact) {
  debugRedact.checked = true;
  debugRedact.disabled = true;
}

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
  if (event.source !== iframe?.contentWindow) {
    pushTimeline("source-rejected", null);
    dlog("message source rejected");
    return;
  }
  if (event.origin !== APP_ORIGIN) {
    pushTimeline("origin-rejected", { origin: event.origin });
    dlog("origin rejected");
    return;
  }
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "syrin:ready") {
    const appProtocol = Number.isFinite(data.protocol) ? data.protocol : 1;
    // Build identifiers are attacker-controlled and are never needed verbatim.
    const buildId = typeof data.buildId === "string" ? "<redacted>" : null;
    const appVersion = safeAppVersion(data.appVersion);
    pushTimeline("ready", { protocol: appProtocol, buildId, appVersion });

    if (appProtocol < MIN_APP_PROTOCOL || appProtocol > MAX_APP_PROTOCOL) {
      // Ignore stray version-mismatch messages once we're already ready:
      // the app may remount during a PWA update and briefly re-broadcast
      // an odd handshake; we must not tear down a working session.
      if (ready) {
        dlog("stray version-mismatch after ready, ignored", `proto=${appProtocol}`);
        recordTelemetry("handshake-version-mismatch-ignored", {
          appBuildId: buildId,
          retryCount,
          detail: { appProtocol, extProtocol: HANDSHAKE_PROTOCOL },
        });
        return;
      }
      readyAppProtocol = appProtocol;
      readyBuildId = buildId;
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
      dlog("ready received", `buildId=${buildId ? "present" : "absent"} proto=${appProtocol}`);
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
      dlog("ack sent", summarizeSlugForDiagnostics(data.slug));
    } catch (err) {
      console.warn("[syrin-note] ack failed", err);
    }
    // The web app sends this field only for edit scope. Owner capabilities
    // are deliberately never accepted or persisted by the extension.
    persistEditCapability(data.slug, data.editCapability);
    if (data.slug === lastSavedSlug) return;
    lastSavedSlug = data.slug;
    updateDebugLast(data.slug);
    try {
      chrome.storage.sync.set({ lastSlug: data.slug }, () => {
        if (chrome.runtime.lastError) {
          console.error("[syrin-note] storage.set lastSlug failed", chrome.runtime.lastError);
          dlog("storage write FAILED", chrome.runtime.lastError.message);
        } else {
          dlog("storage write ok", summarizeSlugForDiagnostics(data.slug));
        }
      });
    } catch (err) {
      console.error("[syrin-note] failed to save lastSlug", err);
    }
  }
});

function loadDefaultsWithFallback(cb) {
  const defaults = { openMode: "home", defaultSlug: "", lastSlug: "", debug: false };
  const finish = (settings) => {
    try {
      chrome.storage.local.get({ editCapabilities: {} }, (local) => {
        if (chrome.runtime.lastError) {
          cb({ ...settings, editCapabilities: {} });
          return;
        }
        const editCapabilities = local.editCapabilities && typeof local.editCapabilities === "object"
          ? local.editCapabilities
          : {};
        cb({ ...settings, editCapabilities });
      });
    } catch {
      cb({ ...settings, editCapabilities: {} });
    }
  };
  try {
    chrome.storage.sync.get(defaults, (settings) => {
      if (chrome.runtime.lastError) {
        dlog("storage.sync unavailable, using defaults", chrome.runtime.lastError.message);
        recordTelemetry("storage-sync-fallback", {
          retryCount,
          detail: { reason: chrome.runtime.lastError.message },
        });
        finish(defaults);
        return;
      }
      finish(settings);
    });
  } catch (err) {
    dlog("storage.sync threw, using defaults", String(err?.message || err));
    finish(defaults);
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
  dlog(isRetry ? "reloading" : "loading", summarizeUrlForDiagnostics(currentSrc));
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

let cachedCspProbe = null;
let cachedCspProbeAt = 0;
const CSP_CACHE_TTL_MS = 5000;

async function verifyFrameAncestorsCsp({ force = false } = {}) {
  if (!force && cachedCspProbe && Date.now() - cachedCspProbeAt < CSP_CACHE_TTL_MS) {
    return cachedCspProbe;
  }
  let result;
  try {
    const res = await fetch(`${APP_ORIGIN}/`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
    });
    const csp = res.headers.get("content-security-policy") || "";
    if (!csp) result = { ok: false, csp: null, reason: "no CSP header" };
    else if (!/frame-ancestors/i.test(csp)) result = { ok: false, csp, reason: "missing frame-ancestors" };
    else if (!/chrome-extension:\/\//i.test(csp))
      result = { ok: false, csp, reason: "frame-ancestors excludes chrome-extension://" };
    else result = { ok: true, csp, reason: null };
  } catch (err) {
    result = { ok: false, csp: null, reason: `fetch failed: ${err?.message || err}` };
  }
  cachedCspProbe = result;
  cachedCspProbeAt = Date.now();
  return result;
}

async function showFallback() {
  loader.hidden = true;
  iframe.hidden = true;
  fallback.hidden = false;
  if (diagUrl) diagUrl.textContent = summarizeUrlForDiagnostics(currentSrc);
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
  const csp = await verifyFrameAncestorsCsp();
  const reason = resolveFallbackReason({
    versionMismatchReason,
    csp,
    ready,
    retryCount,
    appReachable: head,
  });
  if (fallbackReason) {
    fallbackReason.hidden = !reason;
    fallbackReason.textContent = reason || "";
  }
  if (fallbackCopyDiag) fallbackCopyDiag.hidden = false;
  dlog("fallback shown", `head=${head} reason=${reason ?? "none"}`);
  void renderTelemetryList();
}

async function buildDiagnosticsBundle() {
  const csp = await verifyFrameAncestorsCsp();
  const telemetryEnabled = await readTelemetryEnabledAsync();
  const telemetry = telemetryEnabled ? await readTelemetry() : [];
  const bundle = {
    kind: DIAGNOSTICS_KIND,
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
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
    telemetryEnabled,
    debugLines: snapshotDebugLog(),
  };
  const sanitized = redactDiagnosticsBundle(bundle);
  // Test-only injection remains after sanitization so the validator's
  // forbidden-key denylist can still be exercised end-to-end. Invalid
  // bundles are blocked before clipboard/download serialization.
  if (
    typeof window !== "undefined" &&
    typeof window.__SYRIN_TEST_INJECT_FORBIDDEN_KEY__ === "string"
  ) {
    return {
      ...sanitized,
      [window.__SYRIN_TEST_INJECT_FORBIDDEN_KEY__]: "injected-by-test",
    };
  }
  return sanitized;
}

function showDiagnosticsValidationError(errors) {
  if (!diagValidation) return;
  if (!errors.length) {
    diagValidation.hidden = true;
    diagValidation.textContent = "";
    return;
  }
  if (diagDetails) diagDetails.open = true;
  diagValidation.hidden = false;
  diagValidation.textContent = `Diagnostics bundle failed schema validation: ${errors.join("; ")}`;
  dlog("diagnostics schema invalid", errors.join("; "));
}

diagCopy?.addEventListener("click", async () => {
  const rawBundle = await buildDiagnosticsBundle();
  // Copy path uses a truncated clone so oversized telemetry.detail entries
  // never fail schema validation or bloat the clipboard. The on-screen
  // panel keeps the untruncated bundle.
  const bundle = truncateTelemetryDetails(rawBundle);
  const verdict = validateDiagnostics(bundle);
  showDiagnosticsValidationError(verdict.errors);
  if (!verdict.ok) return;
  navigator.clipboard?.writeText(JSON.stringify(bundle, null, 2)).catch(() => {});
});

// Prominent one-click copy from the fallback overlay (avoids expanding
// the details block for triage). Delegates to the same handler as the
// diagnostics-section copy button.
fallbackCopyDiag?.addEventListener("click", () => diagCopy?.click());

diagDownload?.addEventListener("click", async () => {
  const bundle = truncateTelemetryDetails(await buildDiagnosticsBundle());
  const verdict = validateDiagnostics(bundle);
  showDiagnosticsValidationError(verdict.errors);
  if (!verdict.ok) return;
  const reasonType = diagnosticsReasonType({
    versionMismatchReason: bundle.handshake.versionMismatch,
    csp: bundle.cspFrameAncestors,
    ready: bundle.handshake.ready,
  });
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Filename: syrin-note-diagnostics-<reasonType>-<isoTimestamp>.json
  // Reason token comes first after the prefix so grouped listings sort by
  // failure class. Timestamp uses `-` in place of `:` / `.` for filesystems.
  a.download = `syrin-note-diagnostics-${reasonType}-${bundle.at.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

async function renderTelemetryList() {
  if (!diagTelemetryList) return;
  const enabled = await readTelemetryEnabledAsync();
  if (diagTelemetryStatus) diagTelemetryStatus.textContent = enabled ? "on" : "off (opted out)";
  const events = enabled ? await readTelemetry() : [];
  diagTelemetryList.innerHTML = "";
  if (!events.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = enabled ? "no events yet" : "telemetry disabled";
    diagTelemetryList.appendChild(li);
    return;
  }
  // Show newest first, cap at 30 for readability.
  const recent = events
    .slice(-30)
    .reverse()
    .map((event) => redactTelemetryEventForDiagnostics(event, extensionVersion()));
  for (const e of recent) {
    const li = document.createElement("li");
    const ts = new Date(e.t).toISOString().slice(11, 19);
    const detail = e.detail && Object.keys(e.detail).length
      ? " " + JSON.stringify(e.detail)
      : "";
    li.textContent = `${ts}  ${e.event}  retry=${e.retryCount}${detail}`;
    diagTelemetryList.appendChild(li);
  }
}

diagTelemetryRefresh?.addEventListener("click", () => { void renderTelemetryList(); });
diagTelemetryClear?.addEventListener("click", async () => {
  await clearTelemetry();
  await renderTelemetryList();
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["syrin:telemetryEnabled"] && !fallback.hidden) {
    void renderTelemetryList();
  }
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
