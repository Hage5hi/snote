// Derives a short reason-type token for filenames and telemetry from the
// current handshake / csp / ready state. Kept pure so it can be unit-tested
// and reused between the download filename and future log surfaces.
//
// Priority mirrors resolveFallbackReason():
//   mismatch  → handshake protocol drift
//   csp       → CSP blocks embedding
//   timeout   → no syrin:ready in time
//   ok        → nothing wrong (bundle exported from a healthy panel)

/**
 * @param {{
 *   versionMismatchReason: string | null,
 *   csp: { ok: boolean } | null,
 *   ready: boolean,
 * }} input
 * @returns {"mismatch" | "csp" | "timeout" | "ok"}
 */
export function diagnosticsReasonType({ versionMismatchReason, csp, ready }) {
  if (versionMismatchReason) return "mismatch";
  if (csp && !csp.ok) return "csp";
  if (!ready) return "timeout";
  return "ok";
}
