// Unit tests for validatePwaReadinessState + explainPwaReadinessState.
// Faster than the E2E variants; enumerates missing/malformed fields and
// boundary values.
import { describe, it, expect } from "vitest";
import {
  validatePwaReadinessState,
  explainPwaReadinessState,
  emitPwaReadinessInvalidEvent,
  type PwaUpdateReadinessState,
} from "../pwa-update-readiness";

const validState: PwaUpdateReadinessState = {
  currentBuildId: "build-1",
  pendingBuildId: null,
  updateAvailable: false,
  updateInProgress: false,
  reloadAttemptCount: 0,
  reloadStrategy: null,
  lastRemoteBuildId: null,
  lastAcceptedAt: null,
};

describe("validatePwaReadinessState", () => {
  it("accepts a minimal fully-valid state", () => {
    expect(validatePwaReadinessState(validState)).toBe(true);
    expect(explainPwaReadinessState(validState)).toBeNull();
  });

  it("accepts strategy 'waiting-sw' and 'hard'", () => {
    expect(validatePwaReadinessState({ ...validState, reloadStrategy: "waiting-sw" })).toBe(true);
    expect(validatePwaReadinessState({ ...validState, reloadStrategy: "hard" })).toBe(true);
  });

  it("accepts optional lastRemoteBuildId absent / null / string", () => {
    const { lastRemoteBuildId: _omit, ...noKey } = validState;
    expect(validatePwaReadinessState(noKey)).toBe(true);
    expect(validatePwaReadinessState({ ...validState, lastRemoteBuildId: null })).toBe(true);
    expect(validatePwaReadinessState({ ...validState, lastRemoteBuildId: "x" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["string", "hi"],
    ["number", 1],
  ])("rejects non-object root: %s", (_label, v) => {
    expect(validatePwaReadinessState(v)).toBe(false);
    expect(explainPwaReadinessState(v)?.field).toBe("<root>");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["empty string", ""],
    ["number", 123],
    ["null", null],
  ])("rejects invalid currentBuildId (%s)", (_label, v) => {
    expect(explainPwaReadinessState({ ...validState, currentBuildId: v })?.field).toBe("currentBuildId");
  });

  it.each<[string, unknown]>([
    ["number", 5],
    ["object", {}],
    ["array", []],
  ])("rejects invalid pendingBuildId (%s)", (_label, v) => {
    expect(explainPwaReadinessState({ ...validState, pendingBuildId: v })?.field).toBe("pendingBuildId");
  });

  it.each<[string, keyof PwaUpdateReadinessState]>([
    ["updateAvailable", "updateAvailable"],
    ["updateInProgress", "updateInProgress"],
  ])("rejects non-boolean %s", (_label, key) => {
    expect(explainPwaReadinessState({ ...validState, [key]: "yes" })?.field).toBe(key);
    expect(explainPwaReadinessState({ ...validState, [key]: 1 })?.field).toBe(key);
  });

  it.each<[string, unknown]>([
    ["negative", -1],
    ["float", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["string", "0"],
  ])("rejects invalid reloadAttemptCount (%s)", (_label, v) => {
    expect(explainPwaReadinessState({ ...validState, reloadAttemptCount: v })?.field).toBe("reloadAttemptCount");
  });

  it("accepts boundary reloadAttemptCount 0 and large ints", () => {
    expect(validatePwaReadinessState({ ...validState, reloadAttemptCount: 0 })).toBe(true);
    expect(validatePwaReadinessState({ ...validState, reloadAttemptCount: 9999 })).toBe(true);
  });

  it.each<[string, unknown]>([
    ["teleport", "teleport"],
    ["empty", ""],
    ["number", 1],
    ["object", {}],
  ])("rejects invalid reloadStrategy (%s)", (_label, v) => {
    expect(explainPwaReadinessState({ ...validState, reloadStrategy: v })?.field).toBe("reloadStrategy");
  });

  it("rejects invalid optional lastAcceptedAt", () => {
    expect(explainPwaReadinessState({ ...validState, lastAcceptedAt: "now" })?.field).toBe("lastAcceptedAt");
    expect(explainPwaReadinessState({ ...validState, lastAcceptedAt: Number.NaN })?.field).toBe("lastAcceptedAt");
    expect(validatePwaReadinessState({ ...validState, lastAcceptedAt: 123456 })).toBe(true);
    expect(validatePwaReadinessState({ ...validState, lastAcceptedAt: null })).toBe(true);
  });
});

describe("emitPwaReadinessInvalidEvent", () => {
  it("dispatches CustomEvent with detail when invalid", () => {
    const events: unknown[] = [];
    const handler = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener("snote:pwa-readiness-invalid", handler);
    emitPwaReadinessInvalidEvent({ ...validState, reloadStrategy: "teleport" });
    window.removeEventListener("snote:pwa-readiness-invalid", handler);
    expect(events).toHaveLength(1);
    expect((events[0] as { field: string }).field).toBe("reloadStrategy");
  });

  it("does not dispatch when valid", () => {
    let count = 0;
    const handler = () => count++;
    window.addEventListener("snote:pwa-readiness-invalid", handler);
    emitPwaReadinessInvalidEvent(validState);
    window.removeEventListener("snote:pwa-readiness-invalid", handler);
    expect(count).toBe(0);
  });
});
