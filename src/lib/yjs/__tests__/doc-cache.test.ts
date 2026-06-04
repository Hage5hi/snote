import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { acquireDoc, releaseDoc, __docCacheInternals as I } from "../doc-cache";

beforeEach(() => {
  I.reset();
  I.configure({ max: 2, idleMs: 30_000 });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  I.reset();
});

describe("doc-cache — acquire/release basics", () => {
  it("returns the same doc on reacquire while warm", () => {
    const a = acquireDoc("note-a");
    releaseDoc("note-a");
    const a2 = acquireDoc("note-a");
    expect(a2).toBe(a);
  });

  it("trims to MAX when capacity exceeded", () => {
    I.configure({ max: 2 });
    acquireDoc("a"); acquireDoc("b"); acquireDoc("c");
    expect(I.size()).toBe(2);
    expect(I.isWarm("a")).toBe(false);
    expect(I.isWarm("b")).toBe(true);
    expect(I.isWarm("c")).toBe(true);
  });
});

describe("doc-cache — IDLE_MS timing", () => {
  it("destroys released doc exactly after IDLE_MS, not earlier", () => {
    acquireDoc("a");
    releaseDoc("a");
    vi.advanceTimersByTime(29_999);
    expect(I.isWarm("a")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(I.isWarm("a")).toBe(false);
    expect(I.getDestroyCount()).toBe(1);
  });

  it("reacquire before IDLE_MS cancels destruction (tab returns fast)", () => {
    acquireDoc("a");
    releaseDoc("a");
    vi.advanceTimersByTime(10_000);
    const again = acquireDoc("a");
    expect(again).toBeDefined();
    vi.advanceTimersByTime(60_000);
    // Still warm because reacquire reset releasedAt.
    expect(I.isWarm("a")).toBe(true);
    expect(I.getDestroyCount()).toBe(0);
  });
});

describe("doc-cache — visibilitychange isolation", () => {
  it("destroys only released docs; keeps in-use docs", () => {
    acquireDoc("active");        // in-use
    acquireDoc("released");
    releaseDoc("released");      // pending destroy
    I.fireVisibilityHidden();
    expect(I.isWarm("active")).toBe(true);
    expect(I.isWarm("released")).toBe(false);
  });

  it("rapid hide/show does not destroy the active doc", () => {
    acquireDoc("active");
    for (let i = 0; i < 5; i++) I.fireVisibilityHidden();
    expect(I.isWarm("active")).toBe(true);
    expect(I.getDestroyCount()).toBe(0);
  });

  it("hide → wait → show → reacquire still returns same active doc", () => {
    const a = acquireDoc("active");
    I.fireVisibilityHidden();
    vi.advanceTimersByTime(60_000);
    const again = acquireDoc("active");
    expect(again).toBe(a);
  });
});

describe("doc-cache — rapid navigation race", () => {
  it("acquire → release → acquire in same tick keeps doc", () => {
    const a = acquireDoc("x");
    releaseDoc("x");
    const a2 = acquireDoc("x");
    expect(a2).toBe(a);
    vi.advanceTimersByTime(60_000);
    expect(I.isWarm("x")).toBe(true);
  });
});

describe("doc-cache — config fallback", () => {
  it("falls back to defaults when MAX is invalid", () => {
    I.configure({ max: NaN as unknown as number });
    expect(I.getConfig().MAX).toBe(2);
    I.configure({ max: -5 });
    expect(I.getConfig().MAX).toBe(2);
    I.configure({ max: 0 });
    expect(I.getConfig().MAX).toBe(2);
  });

  it("falls back to defaults when IDLE_MS is invalid", () => {
    I.configure({ idleMs: Infinity });
    expect(I.getConfig().IDLE_MS).toBe(30_000);
    I.configure({ idleMs: -1 });
    expect(I.getConfig().IDLE_MS).toBe(30_000);
  });

  it("honors valid overrides", () => {
    I.configure({ max: 5, idleMs: 1000 });
    expect(I.getConfig()).toEqual({ MAX: 5, IDLE_MS: 1000 });
  });
});

describe("doc-cache — debug logging", () => {
  it("does not log when disabled (default)", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    I.setDebug(false);
    acquireDoc("a");
    releaseDoc("a");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs MAX/IDLE_MS and destroy count when enabled", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    I.setDebug(true);
    acquireDoc("a");
    releaseDoc("a");
    vi.advanceTimersByTime(30_000);
    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(calls.some((c) => c && "MAX" in c && "IDLE_MS" in c)).toBe(true);
    I.setDebug(false);
    spy.mockRestore();
  });
});
