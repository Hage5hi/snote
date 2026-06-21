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
    lines: (payload.lines || []).map((l) => ({ t: l.t, msg: redactLine(l.msg) })),
  };
}
