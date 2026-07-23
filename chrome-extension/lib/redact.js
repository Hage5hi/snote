// Redaction rules for the debug-log export. Each rule documents what it
// masks and why, so reviewers (and tests) can audit coverage.
//
// Design notes:
// - Conservative: when in doubt, mask. False positives (over-masking) are
//   acceptable; false negatives (leaking a secret) are not.
// - Stable output: masked tokens keep first/last char so reports are still
//   minimally diff-able without leaking length-revealing detail for short
//   strings.
// - Order matters: URL/email/JWT rules run before generic token rules so
//   structured patterns aren't shredded into pieces by the token regex.

// Mask a slug-like token: keep first/last char, replace middle with •••.
// Empty/short values become "•••" so length isn't leaked usefully.
export function maskToken(s) {
  if (s == null) return "";
  const str = String(s);
  if (str.length <= 2) return "•••";
  return `${str[0]}•••${str[str.length - 1]}`;
}

// Reduce a URL to scheme+host (origin) plus a "/…" marker. Path/query/hash
// are stripped because they often contain slugs, ids, share tokens or
// signed-URL signatures.
export function redactUrl(raw) {
  try {
    return new URL(String(raw)).origin + "/…";
  } catch {
    return "<url>";
  }
}

// Locator-safe summaries for debug logging. Raw slugs and iframe paths must
// never enter console output or the in-memory debug ring buffer.
export function summarizeSlugForDiagnostics(slug) {
  return `slugLength=${String(slug ?? "").length}`;
}

export function summarizeUrlForDiagnostics(raw) {
  try {
    const url = new URL(String(raw));
    const segments = url.pathname.split("/").filter(Boolean);
    const route = segments.length === 0
      ? "root"
      : segments[0].toLowerCase() === "s"
        ? "share"
        : "note";
    return `${redactUrl(raw)} route=${route}`;
  } catch {
    return "<url> route=invalid";
  }
}

// Ordered redaction rules applied to free-text log lines.
// `name` and `why` are surfaced for documentation/audit.
export const REDACTION_RULES = [
  {
    name: "url",
    why: "Strip path/query/hash — they often carry slugs, share tokens, or signed-URL signatures.",
    pattern: /https?:\/\/[^\s"']+/g,
    replace: (m) => redactUrl(m),
  },
  {
    name: "email",
    why: "Email addresses are PII; mask local part and domain label but keep the TLD shape for debugging.",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: () => "<email>",
  },
  {
    name: "jwt",
    why: "JWTs (three base64url segments) are bearer credentials.",
    pattern: /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: () => "<jwt>",
  },
  {
    name: "bearer",
    why: "`Authorization: Bearer …` and `token=…`/`apikey=…` query params leak credentials.",
    pattern: /\b(bearer|token|apikey|api[_-]?key|secret|password)\s*[:=]\s*\S+/gi,
    replace: (_m, k) => `${k}=<redacted>`,
  },
  {
    name: "api-key-prefixed",
    why: "Provider-prefixed API keys (sk_, pk_, ghp_, AIza…, AKIA…) are obvious secrets.",
    pattern: /\b(sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xoxb|xoxp|AIza|AKIA|ASIA)[_A-Za-z0-9-]{16,}\b/g,
    replace: () => "<api-key>",
  },
  {
    name: "uuid",
    why: "UUIDs are commonly resource ids that reveal account/tenant scope.",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replace: () => "<uuid>",
  },
  {
    name: "fs-path",
    why: "Absolute filesystem paths leak usernames (e.g. /Users/alice, /home/bob, C:\\Users\\bob).",
    pattern: /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\s"'\\/]+/g,
    replace: () => "<path>",
  },
  {
    name: "username-at",
    why: "`@handle` style mentions leak usernames in chat-app contexts.",
    pattern: /(^|\s)@[A-Za-z0-9_.-]{2,}/g,
    replace: (_m, lead) => `${lead}@<user>`,
  },
  {
    name: "labeled-slug",
    why: "Lines we emit with known prefixes carry the slug verbatim — mask them.",
    pattern: /\b(ack sent|storage write ok|storage write FAILED|lastSlug:|slug:)\s+(\S+)/g,
    replace: (_m, prefix, tok) => `${prefix} ${maskToken(tok)}`,
  },
  {
    name: "long-token",
    why: "Catch-all for opaque high-entropy tokens not matched by named rules above.",
    pattern: /\b[A-Za-z0-9_-]{32,}\b/g,
    replace: (m) => maskToken(m),
  },
];

export function redactLine(msg) {
  let out = String(msg);
  for (const rule of REDACTION_RULES) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

export function redactPayload(payload) {
  return {
    ...payload,
    redacted: true,
    lastSlug: payload.lastSlug ? maskToken(payload.lastSlug) : null,
    iframeSrc: payload.iframeSrc ? redactUrl(payload.iframeSrc) : null,
    lines: (payload.lines || []).map((l) => ({ t: l.t, msg: classifyDebugMessage(l.msg) })),
  };
}

const DIAGNOSTICS_KIND = "syrin-note-sidepanel-diagnostics";
const REDACTED_VALUE = "<redacted>";
const TIMELINE_KINDS = new Set([
  "origin-rejected",
  "ready",
  "slug",
  "iframe-retry",
  "iframe-load",
  "iframe-load-event",
]);
const TELEMETRY_EVENTS = new Set([
  "handshake-version-mismatch-ignored",
  "handshake-version-mismatch",
  "handshake-ok",
  "storage-sync-fallback",
  "retry-attempted",
  "fallback-shown",
]);
const DETAIL_KEYS = new Set([
  "protocol",
  "len",
  "buildId",
  "appVersion",
  "origin",
  "retryCount",
  "appProtocol",
  "extProtocol",
  "extVersion",
  "iframeLoaded",
  "reason",
  "nested",
  "value",
  "_truncated",
  "keys",
  "truncated",
  "bytes",
  "limit",
  "preview",
]);
const DEBUG_EVENT_PREFIXES = [
  "export blocked: schema invalid",
  "debug log exported",
  "origin rejected",
  "stray version-mismatch after ready, ignored",
  "handshake version mismatch",
  "ready received",
  "ack sent",
  "storage write FAILED",
  "storage write ok",
  "storage.sync unavailable, using local",
  "storage.sync threw, using defaults",
  "watchdog fired, retrying",
  "watchdog fired, showing fallback",
  "reloading",
  "loading",
  "fallback shown",
  "diagnostics schema invalid",
  "iframe load event",
];

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function nullableFiniteNumber(value) {
  return value === null ? null : Number.isFinite(value) ? value : null;
}

function safeVersion(value) {
  return typeof value === "string" && value.length <= 64 &&
    /^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(value)
    ? value
    : "unknown";
}

function redactNestedDiagnosticValue(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return REDACTED_VALUE;
  if (depth >= 4) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((item) => redactNestedDiagnosticValue(item, depth + 1));
  }
  if (typeof value !== "object") return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!DETAIL_KEYS.has(key)) continue;
    out[key] = redactNestedDiagnosticValue(item, depth + 1);
  }
  return out;
}

function redactTelemetryDetail(detail) {
  const redacted = redactNestedDiagnosticValue(detail);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  for (const key of ["appVersion", "extVersion"]) {
    if (typeof detail?.[key] === "string") redacted[key] = safeVersion(detail[key]);
  }
  return redacted;
}

function classifyReachability(value) {
  if (value === "offline" || value === "online-unverified") return value;
  return "unknown";
}

function classifyCspReason(reason) {
  if (reason == null) return null;
  if (reason === "not-inspected") return "not-inspected";
  if (reason === "no CSP header") return "no-header";
  if (reason === "missing frame-ancestors") return "missing-frame-ancestors";
  if (reason === "frame-ancestors excludes chrome-extension://") return "extension-excluded";
  if (typeof reason === "string" && reason.startsWith("fetch failed:")) return "probe-failed";
  return "unknown";
}

function classifyDebugMessage(message) {
  const redacted = redactLine(message);
  return DEBUG_EVENT_PREFIXES.find(
    (prefix) => redacted === prefix || redacted.startsWith(`${prefix} `),
  ) || "debug-event";
}

// Sanitize both newly-recorded and historical telemetry before it is rendered
// or included in an exported diagnostics bundle.
export function redactTelemetryEventForDiagnostics(event, extensionVersion = "unknown") {
  return {
    t: finiteNumber(event?.t),
    event: TELEMETRY_EVENTS.has(event?.event) ? event.event : "unknown",
    extVersion: safeVersion(extensionVersion),
    appBuildId: typeof event?.appBuildId === "string" ? REDACTED_VALUE : null,
    retryCount: finiteNumber(event?.retryCount),
    detail: redactTelemetryDetail(event?.detail),
  };
}

// Diagnostics copy/download is always sanitized, independently of the
// debug-log export settings. Reconstruct only the documented schema fields:
// mutable app/network/storage strings become fixed classifications, while
// numbers, booleans and nulls retain their diagnostic value.
export function redactDiagnosticsBundle(bundle) {
  const handshake = bundle?.handshake || {};
  const load = bundle?.load || {};
  const csp = bundle?.cspFrameAncestors || {};
  const cspInspected = csp.inspected === true;
  const extensionVersion = safeVersion(bundle?.extensionVersion);
  return {
    kind: DIAGNOSTICS_KIND,
    schemaVersion: finiteNumber(bundle?.schemaVersion),
    at:
      typeof bundle?.at === "string" && !Number.isNaN(Date.parse(bundle.at))
        ? bundle.at
        : new Date(0).toISOString(),
    extensionVersion,
    handshake: {
      extensionProtocol: finiteNumber(handshake.extensionProtocol),
      appProtocol: nullableFiniteNumber(handshake.appProtocol),
      appBuildId: typeof handshake.appBuildId === "string" ? REDACTED_VALUE : null,
      ready: !!handshake.ready,
      versionMismatch:
        typeof handshake.versionMismatch === "string" ? "protocol-mismatch" : null,
    },
    load: {
      iframeSrc: redactUrl(load.iframeSrc),
      iframeLoaded: !!load.iframeLoaded,
      retryCount: finiteNumber(load.retryCount),
      appReachable: classifyReachability(load.appReachable),
    },
    cspFrameAncestors: {
      inspected: cspInspected,
      ok: cspInspected ? csp.ok === true : null,
      csp: cspInspected && typeof csp.csp === "string" ? REDACTED_VALUE : null,
      reason: cspInspected ? classifyCspReason(csp.reason) : "not-inspected",
    },
    messageTimeline: (Array.isArray(bundle?.messageTimeline) ? bundle.messageTimeline : [])
      .slice(-30)
      .map((item) => ({
        t: finiteNumber(item?.t),
        kind: TIMELINE_KINDS.has(item?.kind) ? item.kind : "unknown",
        detail: redactNestedDiagnosticValue(item?.detail),
      })),
    telemetry: (Array.isArray(bundle?.telemetry) ? bundle.telemetry : [])
      .slice(-100)
      .map((event) => redactTelemetryEventForDiagnostics(event, extensionVersion)),
    telemetryEnabled: !!bundle?.telemetryEnabled,
    debugLines: (Array.isArray(bundle?.debugLines) ? bundle.debugLines : []).map((line) => ({
      t: finiteNumber(line?.t),
      msg: classifyDebugMessage(line?.msg),
    })),
  };
}
