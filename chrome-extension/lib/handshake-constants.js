// Shared handshake constants. Mirrored in src/lib/ext-context.ts —
// keep values in sync when bumping the protocol.
export const APP_ORIGIN = "https://note.syrin.online";
export const HANDSHAKE_PROTOCOL = 2;
export const MIN_APP_PROTOCOL = 1;
export const MAX_APP_PROTOCOL = 2;
// Fallback watchdog. Overridable in E2E via window.__SYRIN_TEST_TIMEOUT_MS
// so fallback-path specs finish in seconds instead of 12s per retry.
export const DEFAULT_LOAD_TIMEOUT_MS = 12000;
export const MAX_RETRIES = 1;
