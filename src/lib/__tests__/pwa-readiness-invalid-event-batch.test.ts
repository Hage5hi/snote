// Integration test: multiple malformed states emit the correct number of
// events, each carrying the payload for the first failing field of that
// specific call. (Validator is fail-fast — one reason per emit call.)
import { describe, it, expect } from "vitest";
import { emitPwaReadinessInvalidEvent } from "../pwa-update-readiness";

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

describe("emitPwaReadinessInvalidEvent — multi-malformed batch", () => {
  it("emits once per malformed call with the matching reason", () => {
    const details: Array<{ field: string; path: string; received: string }> = [];
    const handler = (e: Event) =>
      details.push((e as CustomEvent).detail as { field: string; path: string; received: string });
    window.addEventListener("snote:pwa-readiness-invalid", handler);

    const cases: Array<[unknown, string]> = [
      [null, "<root>"],
      [{ ...base, currentBuildId: "" }, "currentBuildId"],
      [{ ...base, pendingBuildId: 42 }, "pendingBuildId"],
      [{ ...base, updateAvailable: "yes" }, "updateAvailable"],
      [{ ...base, reloadAttemptCount: -1 }, "reloadAttemptCount"],
      [{ ...base, reloadStrategy: "teleport" }, "reloadStrategy"],
    ];
    for (const [input] of cases) emitPwaReadinessInvalidEvent(input);

    window.removeEventListener("snote:pwa-readiness-invalid", handler);

    expect(details).toHaveLength(cases.length);
    for (let i = 0; i < cases.length; i++) {
      expect(details[i].field).toBe(cases[i][1]);
      expect(details[i].path).toBe(cases[i][1]);
    }
  });

  it("does not emit for valid states interleaved with malformed ones", () => {
    let count = 0;
    const handler = () => count++;
    window.addEventListener("snote:pwa-readiness-invalid", handler);

    emitPwaReadinessInvalidEvent(base); // valid
    emitPwaReadinessInvalidEvent({ ...base, reloadStrategy: "boom" }); // invalid
    emitPwaReadinessInvalidEvent(base); // valid
    emitPwaReadinessInvalidEvent({ ...base, currentBuildId: 1 }); // invalid

    window.removeEventListener("snote:pwa-readiness-invalid", handler);
    expect(count).toBe(2);
  });
});
