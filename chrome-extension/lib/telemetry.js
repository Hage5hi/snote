// Privacy-safe local telemetry for the side panel. Records structured
// events (handshake success, retry, fallback, version mismatch, storage
// fallback, etc.) to a bounded ring buffer in chrome.storage.local.
//
// Nothing leaves the user's machine. No slugs, note content, or URLs
// beyond the app origin are captured. Users can inspect / clear via the
// Export Diagnostics button.

const KEY = "syrin:telemetry";
const ENABLED_KEY = "syrin:telemetryEnabled";
const MAX_EVENTS = 100;

// Telemetry defaults to ON but can be opted out via the options page.
// Setting is stored in chrome.storage.local (device-scoped, not synced,
// to keep the opt-out local and free of any cross-device leakage).
let cachedEnabled = true;
try {
  chrome.storage?.local?.get?.({ [ENABLED_KEY]: true }, (s) => {
    cachedEnabled = !!s[ENABLED_KEY];
  });
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === "local" && changes[ENABLED_KEY]) {
      cachedEnabled = !!changes[ENABLED_KEY].newValue;
    }
  });
} catch {
  /* not in extension context */
}

export function isTelemetryEnabled() {
  return cachedEnabled;
}

export function setTelemetryEnabled(enabled) {
  cachedEnabled = !!enabled;
  try {
    chrome.storage.local.set({ [ENABLED_KEY]: cachedEnabled });
  } catch {
    /* ignore */
  }
}

export function readTelemetryEnabledAsync() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [ENABLED_KEY]: true }, (s) => {
        resolve(!!s[ENABLED_KEY]);
      });
    } catch {
      resolve(true);
    }
  });
}

/** @typedef {{
 *   t: number,
 *   event: string,
 *   extVersion: string,
 *   appBuildId: string | null,
 *   retryCount: number,
 *   detail: Record<string, string | number | boolean | null>,
 * }} TelemetryEvent */

const MAX_DETAIL_JSON_BYTES = 512;

function safeDetail(detail) {
  // Whitelist primitives only. Strings are truncated so a rogue caller
  // can't stuff a full URL / slug in accidentally.
  const out = {};
  if (!detail) return out;
  for (const [k, v] of Object.entries(detail)) {
    if (v == null) {
      out[k] = null;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else {
      out[k] = String(v).slice(0, 120);
    }
  }
  // Ring-buffer bloat guard: if the serialized detail is oversized,
  // drop the payload rather than write megabytes to chrome.storage.local.
  try {
    if (JSON.stringify(out).length > MAX_DETAIL_JSON_BYTES) {
      return { _truncated: true, keys: Object.keys(out).slice(0, 8).join(",").slice(0, 120) };
    }
  } catch {
    return { _truncated: true };
  }
  return out;
}

export function recordTelemetry(event, meta = {}) {
  if (!cachedEnabled) return;
  const entry = {
    t: Date.now(),
    event: String(event).slice(0, 40),
    extVersion:
      (chrome.runtime?.getManifest && chrome.runtime.getManifest().version) || "unknown",
    appBuildId: meta.appBuildId ? String(meta.appBuildId).slice(0, 40) : null,
    retryCount: Number.isFinite(meta.retryCount) ? meta.retryCount : 0,
    detail: safeDetail(meta.detail),
  };
  try {
    chrome.storage.local.get({ [KEY]: [] }, (state) => {
      const next = Array.isArray(state[KEY]) ? state[KEY] : [];
      next.push(entry);
      while (next.length > MAX_EVENTS) next.shift();
      chrome.storage.local.set({ [KEY]: next });
    });
  } catch {
    /* not in extension context */
  }
}

export function readTelemetry() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [KEY]: [] }, (state) => {
        resolve(Array.isArray(state[KEY]) ? state[KEY] : []);
      });
    } catch {
      resolve([]);
    }
  });
}

export function clearTelemetry() {
  try {
    chrome.storage.local.remove(KEY);
  } catch {
    /* ignore */
  }
}
