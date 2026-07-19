import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { DiagnosticsPanel } from "@/components/dev/DiagnosticsPanel";
import { truncateDiagEventsForExport } from "@/components/dev/diagnostics-utils";

describe("truncateDiagEventsForExport", () => {
  it("truncates oversized detail and componentStack to 512 bytes", () => {
    const big = "x".repeat(2000);
    const [out] = truncateDiagEventsForExport([
      { id: 1, at: 0, kind: "error", message: "m", detail: big, componentStack: big },
    ]);
    expect(out.detail!.length).toBeLessThan(600);
    expect(out.detail).toContain("[truncated");
    expect(out.componentStack).toContain("[truncated");
  });

  it("leaves small details untouched", () => {
    const [out] = truncateDiagEventsForExport([
      { id: 1, at: 0, kind: "warn", message: "m", detail: "small" },
    ]);
    expect(out.detail).toBe("small");
  });

  it("exported payload matches panel event ids/messages exactly", () => {
    const events = [
      { id: 1, at: 100, kind: "warn" as const, message: "hello", detail: "d1" },
      { id: 2, at: 200, kind: "error" as const, message: "boom", detail: "x".repeat(1000) },
    ];
    const out = truncateDiagEventsForExport(events);
    expect(out.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(out.map((e) => e.message)).toEqual(events.map((e) => e.message));
    expect(out.map((e) => e.kind)).toEqual(events.map((e) => e.kind));
    // Small details are byte-identical to what the panel would display.
    expect(out[0].detail).toBe(events[0].detail);
  });
});

describe("DiagnosticsPanel disabled in prod-like build", () => {
  const origDev = import.meta.env.DEV;
  const origFlag = import.meta.env.VITE_DEBUG_DIAGNOSTICS_PANEL;
  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).DEV = false;
    (import.meta.env as Record<string, unknown>).VITE_DEBUG_DIAGNOSTICS_PANEL = undefined;
  });
  afterEach(() => {
    (import.meta.env as Record<string, unknown>).DEV = origDev;
    (import.meta.env as Record<string, unknown>).VITE_DEBUG_DIAGNOSTICS_PANEL = origFlag;
    cleanup();
  });

  it("renders nothing and does not patch console when disabled", () => {
    const origWarn = console.warn;
    const origError = console.error;
    const { container } = render(<DiagnosticsPanel />);
    expect(container.querySelector('[data-diagnostics-panel]')).toBeNull();
    // Console methods must be untouched.
    expect(console.warn).toBe(origWarn);
    expect(console.error).toBe(origError);

    // Emitting a warn/error should not attach anything or throw.
    act(() => {
      console.warn("should-not-capture");
      console.error("should-not-capture");
    });
    expect(container.querySelector('[data-diagnostics-panel]')).toBeNull();
  });
});
