// Schema for the diagnostics bundle produced by the side panel's
// "Copy diagnostics" / "Download diagnostics JSON" buttons.
// Hand-rolled tiny validator — see export-schema.js for the same pattern.

export const DIAGNOSTICS_KIND = "syrin-note-sidepanel-diagnostics";
// v2: adds filename reason-type token + explicit forbidden-key denylist.
export const DIAGNOSTICS_SCHEMA_VERSION = 2;

// Must match MAX_DETAIL_JSON_BYTES in lib/telemetry.js.
export const MAX_TELEMETRY_DETAIL_BYTES = 512;

// Keys that must NEVER appear anywhere in the exported bundle. Checked
// recursively — presence of any of these anywhere is a validation error,
// not just a soft warning.
export const FORBIDDEN_KEYS = Object.freeze([
  "slug",
  "lastSlug",
  "noteBody",
  "content",
  "userEmail",
  "authToken",
  "accessToken",
  "password",
  "sessionId",
]);

function findForbiddenKey(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findForbiddenKey(item, seen);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) return key;
    const hit = findForbiddenKey(value[key], seen);
    if (hit) return hit;
  }
  return null;
}

const FIELDS = {
  kind: { type: "string", const: DIAGNOSTICS_KIND },
  schemaVersion: { type: "number", const: DIAGNOSTICS_SCHEMA_VERSION },
  at: {
    type: "string",
    check: (v) => !Number.isNaN(Date.parse(v)) || "at must be ISO-8601",
  },
  extensionVersion: { type: "string" },
  handshake: {
    type: "object",
    check: (v) => {
      if (typeof v.extensionProtocol !== "number") return "handshake.extensionProtocol";
      if (v.appProtocol !== null && typeof v.appProtocol !== "number")
        return "handshake.appProtocol";
      if (v.appBuildId !== null && typeof v.appBuildId !== "string")
        return "handshake.appBuildId";
      if (typeof v.ready !== "boolean") return "handshake.ready";
      if (v.versionMismatch !== null && typeof v.versionMismatch !== "string")
        return "handshake.versionMismatch";
      return true;
    },
  },
  load: {
    type: "object",
    check: (v) => {
      if (typeof v.iframeSrc !== "string") return "load.iframeSrc";
      if (typeof v.iframeLoaded !== "boolean") return "load.iframeLoaded";
      if (typeof v.retryCount !== "number") return "load.retryCount";
      return true;
    },
  },
  cspFrameAncestors: { type: "object" },
  messageTimeline: { type: "array" },
  telemetry: {
    type: "array",
    check: (arr) => {
      // Per-event detail must be bounded — mirrors the 512-byte cap in
      // telemetry.js so a corrupted/oversized event can't leak into a
      // diagnostics bundle even if storage was tampered with.
      for (let i = 0; i < arr.length; i++) {
        const detail = arr[i]?.detail;
        if (detail == null) continue;
        try {
          if (JSON.stringify(detail).length > MAX_TELEMETRY_DETAIL_BYTES) {
            return `telemetry[${i}].detail exceeds ${MAX_TELEMETRY_DETAIL_BYTES} bytes`;
          }
        } catch {
          return `telemetry[${i}].detail not serializable`;
        }
      }
      return true;
    },
  },
  telemetryEnabled: { type: "boolean" },
  debugLines: { type: "array" },
};

function typeOk(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

export function validateDiagnostics(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["payload not an object"] };
  }
  for (const [key, spec] of Object.entries(FIELDS)) {
    if (!(key in payload)) {
      errors.push(`missing field: ${key}`);
      continue;
    }
    const v = payload[key];
    if (!typeOk(v, spec.type)) {
      errors.push(`field ${key}: wrong type`);
      continue;
    }
    if (spec.const !== undefined && v !== spec.const) {
      errors.push(`field ${key}: must equal ${JSON.stringify(spec.const)}`);
    }
    if (spec.check) {
      const r = spec.check(v);
      if (r !== true) errors.push(`field ${key}: ${r}`);
    }
  }
  const leaked = findForbiddenKey(payload);
  if (leaked) errors.push(`forbidden key present: ${leaked}`);
  return { ok: errors.length === 0, errors };
}
