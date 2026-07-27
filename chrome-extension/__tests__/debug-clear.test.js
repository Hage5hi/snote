import { beforeEach, describe, expect, it, vi } from "vitest";

describe("debug buffer clearing", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("removes prior lines from subsequent copy/export snapshots", async () => {
    const debug = await import("../lib/debug.js");
    debug.setDebug(true);
    debug.dlog("private locator must not survive clear");
    expect(debug.snapshotDebugLog()).toHaveLength(1);

    debug.clearDebugLog();

    expect(debug.snapshotDebugLog()).toEqual([]);
  });
});
