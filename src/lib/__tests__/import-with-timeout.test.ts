import { afterEach, describe, expect, it, vi } from "vitest";
import { importWithTimeoutRetry } from "@/lib/import-with-timeout";

describe("importWithTimeoutRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the first successful load", async () => {
    const onGiveUp = vi.fn();
    const result = await importWithTimeoutRetry(async () => ({ default: "ok" }), {
      timeoutMs: 50,
      onGiveUp,
    });
    expect(result).toEqual({ default: "ok" });
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("retries once after a rejected import and then succeeds", async () => {
    const onGiveUp = vi.fn();
    let calls = 0;
    const result = await importWithTimeoutRetry(async () => {
      calls += 1;
      if (calls === 1) throw new Error("chunk missing");
      return { default: "recovered" };
    }, {
      timeoutMs: 50,
      onGiveUp,
    });
    expect(result).toEqual({ default: "recovered" });
    expect(calls).toBe(2);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("retries once after a timeout and then succeeds", async () => {
    vi.useFakeTimers();
    const onGiveUp = vi.fn();
    let calls = 0;
    const pending = importWithTimeoutRetry(() => {
      calls += 1;
      if (calls === 1) return new Promise<{ default: string }>(() => {});
      return Promise.resolve({ default: "late" });
    }, {
      timeoutMs: 25,
      onGiveUp,
    });

    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual({ default: "late" });
    expect(calls).toBe(2);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("gives up after a timeout plus one failed retry", async () => {
    vi.useFakeTimers();
    const onGiveUp = vi.fn();
    const pending = importWithTimeoutRetry(
      () => new Promise<{ default: string }>(() => {}),
      { timeoutMs: 25, onGiveUp },
    );

    const expectation = expect(pending).rejects.toThrow(/import-timeout/);
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(25);
    await expectation;
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });
});
