// Pure resolver for the fallback overlay's one-line reason banner.
// Extracted so it can be unit-tested without spinning up the panel.

/**
 * @param {{
 *   versionMismatchReason: string | null,
 *   csp: { ok: boolean, reason: string | null } | null,
 *   ready: boolean,
 *   retryCount: number,
 *   appReachable: string | null,
 * }} input
 * @returns {string | null}
 */
export function resolveFallbackReason({
  versionMismatchReason,
  csp,
  ready,
  retryCount,
  appReachable,
}) {
  if (versionMismatchReason) {
    return `Handshake protocol mismatch: ${versionMismatchReason}`;
  }
  if (csp && !csp.ok) {
    return `App CSP blocks embedding: ${csp.reason || "frame-ancestors invalid"}`;
  }
  if (!ready) {
    return `App never sent syrin:ready after ${retryCount} retry(ies). App reachable = ${appReachable ?? "unknown"}.`;
  }
  return null;
}
