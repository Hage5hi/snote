// Shared schema/validator for the PWA update readiness state exposed on
// `window.__SNOTE_PWA_UPDATE_STATE__`. Used by:
//   - <PwaUpdateDebugPanel> to gate mounting on a fully valid object.
//   - E2E specs (via `window.__SNOTE_PWA_READINESS_VALIDATE__` in DEV) so
//     both sides agree on what "valid" means.
//
// Hand-rolled (no zod dep) to keep bundle small; shape mirrors the type in
// src/lib/pwa-update.ts.

export type PwaReloadStrategy = "waiting-sw" | "hard" | null;

export type PwaUpdateReadinessState = {
  currentBuildId: string;
  pendingBuildId: string | null;
  updateAvailable: boolean;
  updateInProgress: boolean;
  reloadAttemptCount: number;
  reloadStrategy: PwaReloadStrategy;
  lastRemoteBuildId?: string | null;
};

const RELOAD_STRATEGIES = new Set(["waiting-sw", "hard"]);

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

export function validatePwaReadinessState(input: unknown): input is PwaUpdateReadinessState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const s = input as Record<string, unknown>;

  if (typeof s.currentBuildId !== "string" || s.currentBuildId.length === 0) return false;
  if (!isStringOrNull(s.pendingBuildId)) return false;
  if (typeof s.updateAvailable !== "boolean") return false;
  if (typeof s.updateInProgress !== "boolean") return false;
  if (typeof s.reloadAttemptCount !== "number" || !Number.isFinite(s.reloadAttemptCount) || s.reloadAttemptCount < 0 || !Number.isInteger(s.reloadAttemptCount)) return false;
  if (s.reloadStrategy !== null && !(typeof s.reloadStrategy === "string" && RELOAD_STRATEGIES.has(s.reloadStrategy))) return false;
  if ("lastRemoteBuildId" in s && s.lastRemoteBuildId !== undefined && !isStringOrNull(s.lastRemoteBuildId)) return false;

  return true;
}

/** Install the validator on window so E2E can call the exact same check. */
export function exposeReadinessValidatorForE2E(): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __SNOTE_PWA_READINESS_VALIDATE__?: (v: unknown) => boolean }).__SNOTE_PWA_READINESS_VALIDATE__ =
    validatePwaReadinessState;
}
