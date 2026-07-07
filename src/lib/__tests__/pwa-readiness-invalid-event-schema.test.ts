// Unit tests: JSON schema shape + typed schema parser + sampled reporter.
import { describe, it, expect, vi } from "vitest";
import {
  PWA_READINESS_INVALID_EVENT,
  PwaReadinessInvalidEventDetailJsonSchema,
  PwaReadinessInvalidEventDetailSchema,
  installPwaReadinessInvalidReporter,
  type PwaReadinessInvalidEventDetail,
} from "../pwa-update-readiness";

const valid: PwaReadinessInvalidEventDetail = {
  field: "reloadStrategy",
  path: "reloadStrategy",
  reason: "must be 'waiting-sw'|'hard'|null",
  received: "teleport",
};

describe("PwaReadinessInvalidEventDetailJsonSchema", () => {
  it("declares required fields + strict additionalProperties", () => {
    expect(PwaReadinessInvalidEventDetailJsonSchema.required).toEqual([
      "field",
      "path",
      "reason",
      "received",
    ]);
    expect(PwaReadinessInvalidEventDetailJsonSchema.additionalProperties).toBe(false);
    expect(PwaReadinessInvalidEventDetailJsonSchema.type).toBe("object");
  });
});

describe("PwaReadinessInvalidEventDetailSchema.parse", () => {
  it("accepts a valid detail", () => {
    expect(PwaReadinessInvalidEventDetailSchema.parse(valid)).toBe(valid);
  });
  it.each([
    ["null", null],
    ["missing field", { path: "x", reason: "r", received: "" }],
    ["path != field", { ...valid, path: "other" }],
    ["received not string", { ...valid, received: 1 }],
    ["empty reason", { ...valid, reason: "" }],
  ])("rejects: %s", (_l, v) => {
    expect(PwaReadinessInvalidEventDetailSchema.safeParse(v).success).toBe(false);
  });
});

describe("installPwaReadinessInvalidReporter", () => {
  it("forwards events to sink at sampleRate=1", () => {
    const sink = vi.fn();
    const off = installPwaReadinessInvalidReporter({ sampleRate: 1, sink });
    window.dispatchEvent(new CustomEvent(PWA_READINESS_INVALID_EVENT, { detail: valid }));
    off();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(valid);
  });

  it("drops events when sampleRate=0", () => {
    const sink = vi.fn();
    const off = installPwaReadinessInvalidReporter({ sampleRate: 0, sink });
    window.dispatchEvent(new CustomEvent(PWA_READINESS_INVALID_EVENT, { detail: valid }));
    off();
    expect(sink).not.toHaveBeenCalled();
  });

  it("samples with injected rng deterministically", () => {
    const sink = vi.fn();
    let calls = 0;
    // rng returns 0.05 then 0.9 → first passes (< 0.1), second drops.
    const rng = () => (calls++ === 0 ? 0.05 : 0.9);
    const off = installPwaReadinessInvalidReporter({ sampleRate: 0.1, sink, rng });
    window.dispatchEvent(new CustomEvent(PWA_READINESS_INVALID_EVENT, { detail: valid }));
    window.dispatchEvent(new CustomEvent(PWA_READINESS_INVALID_EVENT, { detail: valid }));
    off();
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("silently drops malformed detail payloads", () => {
    const sink = vi.fn();
    const off = installPwaReadinessInvalidReporter({ sampleRate: 1, sink });
    window.dispatchEvent(new CustomEvent(PWA_READINESS_INVALID_EVENT, { detail: { bogus: true } }));
    off();
    expect(sink).not.toHaveBeenCalled();
  });

  it("swallows sink throws", () => {
    const sink = vi.fn(() => {
      throw new Error("boom");
    });
    const off = installPwaReadinessInvalidReporter({ sampleRate: 1, sink });
    expect(() =>
      window.dispatchEvent(new CustomEvent(PWA_READINESS_INVALID_EVENT, { detail: valid })),
    ).not.toThrow();
    off();
  });
});
