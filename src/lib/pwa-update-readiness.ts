// Shared schema/validator for the PWA update readiness state exposed on
// `window.__SNOTE_PWA_UPDATE_STATE__`. Used by:
//   - <PwaUpdateDebugPanel> to gate mounting on a fully valid object.
//   - src/lib/pwa-update.ts as the source-of-truth type (no drift).
//   - E2E specs (via `window.__SNOTE_PWA_READINESS_VALIDATE__` in DEV).

export type PwaReloadStrategy = "waiting-sw" | "hard" | null;

export type PwaUpdateReadinessState = {
  currentBuildId: string;
  pendingBuildId: string | null;
  updateAvailable: boolean;
  updateInProgress: boolean;
  reloadAttemptCount: number;
  reloadStrategy: PwaReloadStrategy;
  lastRemoteBuildId?: string | null;
  lastAcceptedAt?: number | null;
};

const RELOAD_STRATEGIES = new Set(["waiting-sw", "hard"]);

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

export type PwaReadinessInvalidReason = {
  /** Field name that failed validation (e.g. "reloadStrategy" or "<root>"). */
  field: string;
  /** Alias of `field`, kept for QA/E2E consumers that use dot-path naming. */
  path: string;
  /** Human-readable reason the field is invalid. */
  reason: string;
  /** Runtime typeof / stringified value received. */
  received: string;
};

function mk(field: string, reason: string, received: string): PwaReadinessInvalidReason {
  return { field, path: field, reason, received };
}

/** Returns null when valid; otherwise a single reason describing the first
 *  field that failed the schema. */
export function explainPwaReadinessState(input: unknown): PwaReadinessInvalidReason | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { field: "<root>", reason: "not-object", received: input === null ? "null" : Array.isArray(input) ? "array" : typeof input };
  }
  const s = input as Record<string, unknown>;
  const t = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

  if (typeof s.currentBuildId !== "string" || s.currentBuildId.length === 0)
    return { field: "currentBuildId", reason: "must be non-empty string", received: t(s.currentBuildId) };
  if (!isStringOrNull(s.pendingBuildId))
    return { field: "pendingBuildId", reason: "must be string|null", received: t(s.pendingBuildId) };
  if (typeof s.updateAvailable !== "boolean")
    return { field: "updateAvailable", reason: "must be boolean", received: t(s.updateAvailable) };
  if (typeof s.updateInProgress !== "boolean")
    return { field: "updateInProgress", reason: "must be boolean", received: t(s.updateInProgress) };
  if (
    typeof s.reloadAttemptCount !== "number" ||
    !Number.isFinite(s.reloadAttemptCount) ||
    s.reloadAttemptCount < 0 ||
    !Number.isInteger(s.reloadAttemptCount)
  )
    return { field: "reloadAttemptCount", reason: "must be non-negative integer", received: String(s.reloadAttemptCount) };
  if (s.reloadStrategy !== null && !(typeof s.reloadStrategy === "string" && RELOAD_STRATEGIES.has(s.reloadStrategy)))
    return { field: "reloadStrategy", reason: "must be 'waiting-sw'|'hard'|null", received: String(s.reloadStrategy) };
  if ("lastRemoteBuildId" in s && s.lastRemoteBuildId !== undefined && !isStringOrNull(s.lastRemoteBuildId))
    return { field: "lastRemoteBuildId", reason: "must be string|null|undefined", received: t(s.lastRemoteBuildId) };
  if (
    "lastAcceptedAt" in s &&
    s.lastAcceptedAt !== undefined &&
    s.lastAcceptedAt !== null &&
    (typeof s.lastAcceptedAt !== "number" || !Number.isFinite(s.lastAcceptedAt))
  )
    return { field: "lastAcceptedAt", reason: "must be number|null|undefined", received: t(s.lastAcceptedAt) };

  return null;
}

export function validatePwaReadinessState(input: unknown): input is PwaUpdateReadinessState {
  return explainPwaReadinessState(input) === null;
}

/** Fire a CustomEvent with the first invalid-field reason. No-op when valid
 *  or when window is unavailable. */
export function emitPwaReadinessInvalidEvent(input: unknown): PwaReadinessInvalidReason | null {
  if (typeof window === "undefined") return null;
  const reason = explainPwaReadinessState(input);
  if (!reason) return null;
  try {
    window.dispatchEvent(new CustomEvent("snote:pwa-readiness-invalid", { detail: reason }));
  } catch {
    /* ignore */
  }
  return reason;
}

/** Install the validator on window so E2E can call the exact same check. */
export function exposeReadinessValidatorForE2E(): void {
  if (typeof window === "undefined") return;
  (window as unknown as {
    __SNOTE_PWA_READINESS_VALIDATE__?: (v: unknown) => boolean;
    __SNOTE_PWA_READINESS_EXPLAIN__?: (v: unknown) => PwaReadinessInvalidReason | null;
  }).__SNOTE_PWA_READINESS_VALIDATE__ = validatePwaReadinessState;
  (window as unknown as {
    __SNOTE_PWA_READINESS_EXPLAIN__?: (v: unknown) => PwaReadinessInvalidReason | null;
  }).__SNOTE_PWA_READINESS_EXPLAIN__ = explainPwaReadinessState;
}
