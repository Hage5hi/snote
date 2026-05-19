// Pins that CLI flags override STICKY_* environment variables for
// cleanupStrategy, headScanLines, and debug. Env-only and flag-only
// baselines are included so a regression in either layer is caught.
import { describe, expect, it } from "vitest";
import { parseCliConfig, MARKER_HEAD_SCAN_LINES } from "../ci-sticky-pr-comment-upsert";

describe("parseCliConfig — flags override STICKY_* env vars", () => {
  it("cleanupStrategy: flag=lock beats env=delete", () => {
    const c = parseCliConfig(
      ["--cleanup-strategy", "lock"],
      { STICKY_CLEANUP_STRATEGY: "delete" },
    );
    expect(c.cleanupStrategy).toBe("lock");
  });

  it("cleanupStrategy: flag=delete beats env=lock", () => {
    const c = parseCliConfig(
      ["--cleanup-strategy", "delete"],
      { STICKY_CLEANUP_STRATEGY: "lock" },
    );
    expect(c.cleanupStrategy).toBe("delete");
  });

  it("headScanLines: flag=20 beats env=8", () => {
    const c = parseCliConfig(
      ["--head-scan-lines", "20"],
      { STICKY_HEAD_SCAN_LINES: "8" },
    );
    expect(c.headScanLines).toBe(20);
  });

  it("headScanLines: env-only still applies when no flag given", () => {
    const c = parseCliConfig([], { STICKY_HEAD_SCAN_LINES: "8" });
    expect(c.headScanLines).toBe(8);
  });

  it("debug: --debug flag beats env=unset", () => {
    const c = parseCliConfig(["--debug"], {});
    expect(c.debug).toBe(true);
  });

  it("debug: --debug flag combined with STICKY_DEBUG=1 stays true", () => {
    const c = parseCliConfig(["--debug"], { STICKY_DEBUG: "1" });
    expect(c.debug).toBe(true);
  });

  it("debug: env-only STICKY_DEBUG=1 enables debug without flag", () => {
    const c = parseCliConfig([], { STICKY_DEBUG: "1" });
    expect(c.debug).toBe(true);
  });

  it("debug: STICKY_DEBUG=true also enables", () => {
    expect(parseCliConfig([], { STICKY_DEBUG: "true" }).debug).toBe(true);
  });

  it("debug: STICKY_DEBUG=0 (or unset) leaves debug off without the flag", () => {
    expect(parseCliConfig([], { STICKY_DEBUG: "0" }).debug).toBe(false);
    expect(parseCliConfig([], {}).debug).toBe(false);
  });

  it("all three flags together override all three env vars", () => {
    const c = parseCliConfig(
      ["--cleanup-strategy", "lock", "--head-scan-lines", "12", "--debug"],
      {
        STICKY_CLEANUP_STRATEGY: "delete",
        STICKY_HEAD_SCAN_LINES: "3",
        STICKY_DEBUG: "0",
      },
    );
    expect(c.cleanupStrategy).toBe("lock");
    expect(c.headScanLines).toBe(12);
    expect(c.debug).toBe(true);
  });

  it("baseline: no flags, no env → documented defaults", () => {
    const c = parseCliConfig([], {});
    expect(c.cleanupStrategy).toBe("delete");
    expect(c.headScanLines).toBe(MARKER_HEAD_SCAN_LINES);
    expect(c.debug).toBe(false);
  });
});
