// Verifies the S3 upload helper:
//   • retries transient errors (503 ServiceUnavailable, 429 SlowDown) with
//     bounded exponential backoff and injected jitter,
//   • gives up on non-transient errors (e.g. 403 AccessDenied),
//   • never exceeds the configured concurrency ceiling across many uploads.
import { describe, expect, it, vi } from "vitest";
import {
  classifyS3Error,
  isTransientS3Error,
  putObjectWithRetry,
  uploadAllWithRetry,
} from "../ci/s3-upload-with-retry";

const svcUnavail = () => Object.assign(new Error("ServiceUnavailable"), {
  name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 },
});
const accessDenied = () => Object.assign(new Error("AccessDenied"), {
  name: "AccessDenied", $metadata: { httpStatusCode: 403 },
});

describe("isTransientS3Error", () => {
  it("recognizes 5xx + throttling + slowdown as transient", () => {
    expect(isTransientS3Error(svcUnavail())).toBe(true);
    expect(isTransientS3Error({ name: "SlowDown", $metadata: { httpStatusCode: 503 } })).toBe(true);
    expect(isTransientS3Error({ status: 429 })).toBe(true);
  });
  it("does not retry 403 / validation errors", () => {
    expect(isTransientS3Error(accessDenied())).toBe(false);
    expect(isTransientS3Error({ name: "InvalidArgument" })).toBe(false);
  });
});

describe("putObjectWithRetry", () => {
  it("retries transient failures with exponential backoff and eventually succeeds", async () => {
    const delays: number[] = [];
    let calls = 0;
    const put = vi.fn(async () => {
      calls++;
      if (calls < 3) throw svcUnavail();
    });
    await putObjectWithRetry("k", "body", put, {
      baseDelayMs: 100,
      random: () => 1, // pin jitter to upper bound (100%)
      sleep: async (ms) => { delays.push(ms); },
      logRetries: false,
    });
    expect(put).toHaveBeenCalledTimes(3);
    // 100ms then 200ms — monotonically increasing.
    expect(delays.length).toBe(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
  });

  it("stops immediately on non-transient errors", async () => {
    const put = vi.fn(async () => { throw accessDenied(); });
    await expect(
      putObjectWithRetry("k", "b", put, { sleep: async () => {}, logRetries: false })
    ).rejects.toMatchObject({ name: "AccessDenied" });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts of transient failures", async () => {
    const put = vi.fn(async () => { throw svcUnavail(); });
    await expect(
      putObjectWithRetry("k", "b", put, { maxAttempts: 3, sleep: async () => {}, logRetries: false })
    ).rejects.toMatchObject({ name: "ServiceUnavailable" });
    expect(put).toHaveBeenCalledTimes(3);
  });
});

describe("classifyS3Error — granular categories", () => {
  it("distinguishes throttle vs 5xx vs network vs timeout", () => {
    expect(classifyS3Error({ name: "SlowDown", $metadata: { httpStatusCode: 503 } })).toBe("http-throttle");
    expect(classifyS3Error({ status: 429 })).toBe("http-throttle");
    expect(classifyS3Error({ name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } })).toBe("http-5xx");
    expect(classifyS3Error({ status: 502 })).toBe("http-5xx");
    expect(classifyS3Error({ code: "ECONNRESET" })).toBe("network");
    expect(classifyS3Error(Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }))).toBe("network");
    expect(classifyS3Error({ name: "RequestTimeout" })).toBe("timeout");
    expect(classifyS3Error({ status: 408 })).toBe("timeout");
    expect(classifyS3Error({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } })).toBe("none");
  });
});

describe("putObjectWithRetry — retry logging", () => {
  it("passes the category to onRetry and skips the default logger when provided", async () => {
    const events: Array<{ attempt: number; category: string }> = [];
    let calls = 0;
    const put = vi.fn(async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("slow"), { name: "SlowDown", $metadata: { httpStatusCode: 503 } });
      if (calls === 2) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
    });
    await putObjectWithRetry("k", "b", put, {
      sleep: async () => {},
      onRetry: (info) => events.push({ attempt: info.attempt, category: info.category }),
    });
    expect(events).toEqual([
      { attempt: 1, category: "http-throttle" },
      { attempt: 2, category: "network" },
    ]);
  });

  it("emits a structured [s3-retry] line on stderr by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const put = vi.fn(async () => { calls++; if (calls < 2) throw Object.assign(new Error("x"), { status: 503 }); });
    await putObjectWithRetry("my/key", "b", put, { sleep: async () => {} });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[s3-retry\] key=my\/key attempt=1\/5 category=http-5xx delayMs=\d+ /);
    warn.mockRestore();
  });
});

describe("uploadAllWithRetry — concurrency ceiling", () => {
  it("never runs more than `concurrency` PutObject calls at once", async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, body: i }));
    let inFlight = 0, peak = 0;
    const put = vi.fn(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    await uploadAllWithRetry(entries, put, { concurrency: 3, sleep: async () => {}, logRetries: false });
    expect(put).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
