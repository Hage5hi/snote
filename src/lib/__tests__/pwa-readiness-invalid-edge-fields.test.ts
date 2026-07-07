// Edge-case integration tests: each malformed variant emits the standardized
// {field, path, reason, received} payload with the expected values.
import { describe, it, expect } from "vitest";
import { emitPwaReadinessInvalidEvent, PWA_READINESS_INVALID_EVENT } from "../pwa-update-readiness";

const base = {
  currentBuildId: "b1",
  pendingBuildId: null,
  updateAvailable: false,
  updateInProgress: false,
  reloadAttemptCount: 0,
  reloadStrategy: null as "waiting-sw" | "hard" | null,
  lastRemoteBuildId: null,
  lastAcceptedAt: null,
};

function capture(fn: () => void) {
  const details: Array<{ field: string; path: string; reason: string; received: string }> = [];
  const handler = (e: Event) => details.push((e as CustomEvent).detail);
  window.addEventListener(PWA_READINESS_INVALID_EVENT, handler);
  fn();
  window.removeEventListener(PWA_READINESS_INVALID_EVENT, handler);
  return details;
}

describe("emit payload — edge invalid fields", () => {
  it.each<[string, unknown, string, string]>([
    ["root null", null, "<root>", "null"],
    ["root undefined", undefined, "<root>", "undefined"],
    ["root array", [], "<root>", "array"],
    ["currentBuildId empty", { ...base, currentBuildId: "" }, "currentBuildId", "string"],
    ["currentBuildId number", { ...base, currentBuildId: 1 }, "currentBuildId", "number"],
    ["pendingBuildId number", { ...base, pendingBuildId: 42 }, "pendingBuildId", "number"],
    ["updateAvailable string", { ...base, updateAvailable: "yes" }, "updateAvailable", "string"],
    ["reloadAttemptCount neg", { ...base, reloadAttemptCount: -1 }, "reloadAttemptCount", "-1"],
    ["reloadAttemptCount NaN", { ...base, reloadAttemptCount: Number.NaN }, "reloadAttemptCount", "NaN"],
    ["reloadAttemptCount Infinity", { ...base, reloadAttemptCount: Infinity }, "reloadAttemptCount", "Infinity"],
    ["reloadStrategy bad", { ...base, reloadStrategy: "teleport" }, "reloadStrategy", "teleport"],
    ["lastRemoteBuildId number", { ...base, lastRemoteBuildId: 3 }, "lastRemoteBuildId", "number"],
    ["lastAcceptedAt string", { ...base, lastAcceptedAt: "now" }, "lastAcceptedAt", "string"],
  ])("%s → field=%s received=%s", (_label, input, field, received) => {
    const [d] = capture(() => emitPwaReadinessInvalidEvent(input));
    expect(d).toBeDefined();
    expect(d.field).toBe(field);
    expect(d.path).toBe(field);
    expect(d.received).toBe(received);
    expect(typeof d.reason).toBe("string");
    expect(d.reason.length).toBeGreaterThan(0);
  });
});
