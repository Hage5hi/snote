// Integration test: attach a listener to window and verify the payload of
// 'snote:pwa-readiness-invalid' is {field, path, reason, received} and that
// dispatching does not throw at runtime.
import { describe, it, expect } from "vitest";
import { emitPwaReadinessInvalidEvent } from "../pwa-update-readiness";

const validBase = {
  currentBuildId: "b1",
  pendingBuildId: null,
  updateAvailable: false,
  updateInProgress: false,
  reloadAttemptCount: 0,
  reloadStrategy: null,
  lastRemoteBuildId: null,
  lastAcceptedAt: null,
};

describe("snote:pwa-readiness-invalid event", () => {
  it("emits a CustomEvent with {field, path, reason, received}", () => {
    const received: unknown[] = [];
    const handler = (e: Event) => received.push((e as CustomEvent).detail);
    window.addEventListener("snote:pwa-readiness-invalid", handler);
    expect(() =>
      emitPwaReadinessInvalidEvent({ ...validBase, reloadStrategy: "teleport" }),
    ).not.toThrow();
    window.removeEventListener("snote:pwa-readiness-invalid", handler);

    expect(received).toHaveLength(1);
    const detail = received[0] as Record<string, unknown>;
    expect(detail).toMatchObject({
      field: "reloadStrategy",
      path: "reloadStrategy",
      reason: expect.stringContaining("waiting-sw"),
      received: "teleport",
    });
  });

  it("path === field for every emitted reason", () => {
    const seen: Array<{ field: unknown; path: unknown }> = [];
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { field: unknown; path: unknown };
      seen.push({ field: d.field, path: d.path });
    };
    window.addEventListener("snote:pwa-readiness-invalid", handler);
    emitPwaReadinessInvalidEvent(null);
    emitPwaReadinessInvalidEvent({ ...validBase, currentBuildId: "" });
    emitPwaReadinessInvalidEvent({ ...validBase, reloadAttemptCount: -1 });
    window.removeEventListener("snote:pwa-readiness-invalid", handler);

    expect(seen).toHaveLength(3);
    for (const s of seen) expect(s.path).toBe(s.field);
  });
});
