import { describe, expect, it } from "vitest";
import { truncateDiagEventsForExport } from "@/components/dev/DiagnosticsPanel";

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
});
