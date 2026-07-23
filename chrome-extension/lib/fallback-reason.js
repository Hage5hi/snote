// Pure resolver for the fallback overlay's one-line reason banner.
// Extracted so it can be unit-tested without spinning up the panel.

/**
 * @param {{
 *   versionMismatchReason: string | null,
 *   csp: { inspected: boolean, ok: boolean | null, reason: string | null } | null,
 *   ready: boolean,
 *   iframeLoaded: boolean,
 *   retryCount: number,
 *   appReachable: string | null,
 * }} input
 * @returns {string | null}
 */
export function resolveFallbackReason({
  versionMismatchReason,
  csp,
  ready,
  iframeLoaded,
  retryCount,
  appReachable,
}) {
  if (versionMismatchReason) {
    return `Handshake protocol mismatch: ${versionMismatchReason}`;
  }
  if (csp?.inspected === true && csp.ok === false) {
    return `App CSP blocks embedding: ${csp.reason || "frame-ancestors invalid"}`;
  }
  if (ready) return null;
  if (appReachable === "offline") return "Network is offline. Reconnect, then retry.";

  const loadState = iframeLoaded
    ? "App loaded but never sent syrin:ready"
    : "App did not load or send syrin:ready";
  return `${loadState} after ${retryCount} retry(ies). Network = ${appReachable ?? "unknown"}.`;
}
