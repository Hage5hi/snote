// Privacy-safe local telemetry for the side panel. Records structured
// events (handshake success, retry, fallback, version mismatch, storage
// fallback, etc.) to a bounded ring buffer in chrome.storage.local.
//
// Nothing leaves the user's machine. No slugs, note content, or URLs
// beyond the app origin are captured. Users can inspect / clear via the
// Export Diagnostics button.

const KEY = "syrin:telemetry";
const ENABLED_KEY = "syrin:telemetryEnabled";
const CLEAR_EPOCH_KEY = "syrin:telemetryClearEpoch";
const DATA_EPOCH_KEY = "syrin:telemetryEpoch";
const MAX_EVENTS = 100;
export const TELEMETRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Telemetry defaults to OFF and can be explicitly enabled via the options page.
// Setting is stored in chrome.storage.local (device-scoped, not synced,
// to keep the opt-out local and free of any cross-device leakage).
let cachedEnabled = false;
let writeGeneration = 0;
let clearEpochSequence = 0;

export function isTelemetryEnabled() {
  return cachedEnabled;
}

export function setTelemetryEnabled(enabled) {
  cachedEnabled = !!enabled;
  writeGeneration += 1;
  try {
    chrome.storage.local.set({ [ENABLED_KEY]: cachedEnabled });
    if (!cachedEnabled) void clearTelemetry();
  } catch {
    /* ignore */
  }
}

export function readTelemetryEnabledAsync() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [ENABLED_KEY]: false }, (s) => {
        resolve(chrome.runtime?.lastError ? false : !!s?.[ENABLED_KEY]);
      });
    } catch {
      resolve(false);
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
const REDACTED_VALUE = "<redacted>";
const TELEMETRY_EVENTS = new Set([
  "handshake-version-mismatch-ignored",
  "handshake-version-mismatch",
  "handshake-ok",
  "storage-sync-fallback",
  "retry-attempted",
  "fallback-shown",
]);
const DETAIL_KEYS = new Set([
  "appProtocol",
  "extProtocol",
  "appVersion",
  "extVersion",
  "iframeLoaded",
  "reason",
]);
const VERSION_KEYS = new Set(["appVersion", "extVersion"]);

function safeVersion(value) {
  return typeof value === "string" && value.length <= 64 &&
    /^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(value)
    ? value
    : "unknown";
}

function safeDetail(detail) {
  // Only documented diagnostic fields reach storage. Free-form strings are
  // redacted at ingestion so URLs, slugs and error text never become durable.
  const out = {};
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return out;
  for (const [k, v] of Object.entries(detail)) {
    if (!DETAIL_KEYS.has(k)) continue;
    if (v == null) {
      out[k] = null;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === "boolean") {
      out[k] = v;
    } else if (typeof v === "string") {
      out[k] = VERSION_KEYS.has(k) ? safeVersion(v) : REDACTED_VALUE;
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

function pruneExpired(events, now = Date.now()) {
  if (!Array.isArray(events)) return [];
  const cutoff = now - TELEMETRY_TTL_MS;
  return events.filter((item) => Number.isFinite(item?.t) && item.t >= cutoff);
}

function sanitizeStoredEvent(event) {
  return {
    t: Number.isFinite(event?.t) ? event.t : 0,
    event: TELEMETRY_EVENTS.has(event?.event) ? event.event : "unknown",
    extVersion: safeVersion(event?.extVersion),
    appBuildId: typeof event?.appBuildId === "string" ? REDACTED_VALUE : null,
    retryCount: Number.isFinite(event?.retryCount) ? event.retryCount : 0,
    detail: safeDetail(event?.detail),
  };
}

function currentSanitizedEvents(events, now = Date.now()) {
  return pruneExpired(events, now).map(sanitizeStoredEvent);
}

function clearEpochFrom(state) {
  return typeof state?.[CLEAR_EPOCH_KEY] === "string" && state[CLEAR_EPOCH_KEY]
    ? state[CLEAR_EPOCH_KEY]
    : "initial";
}

function nextClearEpoch() {
  clearEpochSequence = (clearEpochSequence + 1) % Number.MAX_SAFE_INTEGER;
  let nonce = "";
  try {
    nonce = globalThis.crypto?.randomUUID?.() || "";
  } catch {
    /* fall through to the bounded non-cryptographic uniqueness fallback */
  }
  if (!nonce) nonce = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}:${clearEpochSequence.toString(36)}:${nonce}`.slice(0, 96);
}

function telemetrySnapshot(state) {
  const epoch = clearEpochFrom(state);
  const dataEpoch = typeof state?.[DATA_EPOCH_KEY] === "string"
    ? state[DATA_EPOCH_KEY]
    : null;
  const hasClearTombstone = typeof state?.[CLEAR_EPOCH_KEY] === "string";
  const events = Array.isArray(state?.[KEY]) ? state[KEY] : [];

  if (dataEpoch === epoch) {
    return { epoch, dataEpoch, events, current: true, needsEpochMarker: false };
  }
  if (dataEpoch === null && !hasClearTombstone) {
    return { epoch, dataEpoch, events, current: true, needsEpochMarker: true };
  }
  return { epoch, dataEpoch, events: [], current: false, needsEpochMarker: false };
}

function removeTelemetryForSnapshot(snapshot, callback = () => {}) {
  try {
    chrome.storage.local.get(
      { [KEY]: [], [CLEAR_EPOCH_KEY]: null, [DATA_EPOCH_KEY]: null },
      (latest) => {
        if (chrome.runtime?.lastError) {
          callback(false);
          return;
        }
        const latestDataEpoch = typeof latest?.[DATA_EPOCH_KEY] === "string"
          ? latest[DATA_EPOCH_KEY]
          : null;
        const legacyAfterClear = latestDataEpoch === null &&
          typeof latest?.[CLEAR_EPOCH_KEY] === "string";
        if (latestDataEpoch !== snapshot.dataEpoch && !(snapshot.dataEpoch === null && legacyAfterClear)) {
          callback(true);
          return;
        }
        chrome.storage.local.remove(KEY, () => callback(!chrome.runtime?.lastError));
      },
    );
  } catch {
    callback(false);
  }
}

function writeTelemetryEvents(events, epoch, generation, callback = () => {}) {
  try {
    chrome.storage.local.set({ [KEY]: events, [DATA_EPOCH_KEY]: epoch }, () => {
      if (chrome.runtime?.lastError) {
        callback(false);
        return;
      }
      chrome.storage.local.get(
        {
          [KEY]: [],
          [ENABLED_KEY]: false,
          [CLEAR_EPOCH_KEY]: null,
          [DATA_EPOCH_KEY]: null,
        },
        (latest) => {
          const stillCurrent = !chrome.runtime?.lastError &&
            latest?.[ENABLED_KEY] === true &&
            clearEpochFrom(latest) === epoch &&
            latest?.[DATA_EPOCH_KEY] === epoch &&
            (generation === null || generation === writeGeneration);
          if (stillCurrent) {
            callback(true);
            return;
          }
          removeTelemetryForSnapshot(
            { dataEpoch: epoch },
            () => callback(false),
          );
        },
      );
    });
  } catch {
    callback(false);
  }
}

export function recordTelemetry(event, meta = {}) {
  if (!cachedEnabled) return;
  const generation = writeGeneration;
  const entry = {
    t: Date.now(),
    event: TELEMETRY_EVENTS.has(event) ? event : "unknown",
    extVersion: safeVersion(
      (chrome.runtime?.getManifest && chrome.runtime.getManifest().version) || "unknown",
    ),
    appBuildId: typeof meta.appBuildId === "string" ? REDACTED_VALUE : null,
    retryCount: Number.isFinite(meta.retryCount) ? meta.retryCount : 0,
    detail: safeDetail(meta.detail),
  };
  try {
    chrome.storage.local.get({
      [KEY]: [],
      [ENABLED_KEY]: false,
      [CLEAR_EPOCH_KEY]: null,
      [DATA_EPOCH_KEY]: null,
    }, (state) => {
      if (
        !cachedEnabled ||
        generation !== writeGeneration ||
        state?.[ENABLED_KEY] !== true ||
        chrome.runtime?.lastError
      ) return;
      const snapshot = telemetrySnapshot(state);
      const next = currentSanitizedEvents(snapshot.current ? snapshot.events : [], entry.t);
      next.push(entry);
      while (next.length > MAX_EVENTS) next.shift();
      writeTelemetryEvents(next, snapshot.epoch, generation);
    });
  } catch {
    /* not in extension context */
  }
}

export function readTelemetry() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({
        [KEY]: [],
        [ENABLED_KEY]: false,
        [CLEAR_EPOCH_KEY]: null,
        [DATA_EPOCH_KEY]: null,
      }, (state) => {
        if (chrome.runtime?.lastError || state?.[ENABLED_KEY] !== true) {
          resolve([]);
          return;
        }
        const snapshot = telemetrySnapshot(state);
        if (!snapshot.current) {
          removeTelemetryForSnapshot(snapshot, () => resolve([]));
          return;
        }
        const current = currentSanitizedEvents(snapshot.events);
        if (
          snapshot.needsEpochMarker ||
          JSON.stringify(current) !== JSON.stringify(snapshot.events)
        ) {
          writeTelemetryEvents(current, snapshot.epoch, null, (committed) => {
            resolve(committed ? current : []);
          });
          return;
        }
        chrome.storage.local.get({
          [ENABLED_KEY]: false,
          [CLEAR_EPOCH_KEY]: null,
          [DATA_EPOCH_KEY]: null,
        }, (latest) => {
          const stillCurrent = !chrome.runtime?.lastError &&
            latest?.[ENABLED_KEY] === true &&
            clearEpochFrom(latest) === snapshot.epoch &&
            latest?.[DATA_EPOCH_KEY] === snapshot.epoch;
          resolve(stillCurrent ? current : []);
        });
      });
    } catch {
      resolve([]);
    }
  });
}

export function clearTelemetry() {
  writeGeneration += 1;
  const clearEpoch = nextClearEpoch();
  return new Promise((resolve) => {
    const removeEvents = (epochPersisted) => {
      try {
        chrome.storage.local.remove(KEY, () => {
          resolve(epochPersisted && !chrome.runtime?.lastError);
        });
      } catch {
        resolve(false);
      }
    };
    try {
      chrome.storage.local.set({ [CLEAR_EPOCH_KEY]: clearEpoch }, () => {
        const epochPersisted = !chrome.runtime?.lastError;
        removeEvents(epochPersisted);
      });
    } catch {
      removeEvents(false);
    }
  });
}

function initializeTelemetryStorage() {
  try {
    const initialGeneration = writeGeneration;
    chrome.storage?.local?.get?.({
      [ENABLED_KEY]: false,
      [KEY]: [],
      [CLEAR_EPOCH_KEY]: null,
      [DATA_EPOCH_KEY]: null,
    }, (state) => {
      if (initialGeneration !== writeGeneration) return;
      if (chrome.runtime?.lastError || state?.[ENABLED_KEY] !== true) {
        cachedEnabled = false;
        void clearTelemetry();
        return;
      }
      cachedEnabled = true;
      const snapshot = telemetrySnapshot(state);
      if (!snapshot.current) {
        removeTelemetryForSnapshot(snapshot);
        return;
      }
      const current = currentSanitizedEvents(snapshot.events);
      if (
        snapshot.needsEpochMarker ||
        JSON.stringify(current) !== JSON.stringify(snapshot.events)
      ) {
        writeTelemetryEvents(current, snapshot.epoch, initialGeneration);
      }
    });
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== "local") return;
      if (changes[CLEAR_EPOCH_KEY]) writeGeneration += 1;
      if (changes[ENABLED_KEY]) {
        cachedEnabled = changes[ENABLED_KEY].newValue === true;
        writeGeneration += 1;
        if (!cachedEnabled) void clearTelemetry();
      }
    });
  } catch {
    /* not in extension context */
  }
}

initializeTelemetryStorage();
