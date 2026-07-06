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
    });
    expect(put).toHaveBeenCalledTimes(3);
    // 100ms then 200ms — monotonically increasing.
    expect(delays.length).toBe(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
  });

  it("stops immediately on non-transient errors", async () => {
    const put = vi.fn(async () => { throw accessDenied(); });
    await expect(
      putObjectWithRetry("k", "b", put, { sleep: async () => {} })
    ).rejects.toMatchObject({ name: "AccessDenied" });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts of transient failures", async () => {
    const put = vi.fn(async () => { throw svcUnavail(); });
    await expect(
      putObjectWithRetry("k", "b", put, { maxAttempts: 3, sleep: async () => {} })
    ).rejects.toMatchObject({ name: "ServiceUnavailable" });
    expect(put).toHaveBeenCalledTimes(3);
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
    await uploadAllWithRetry(entries, put, { concurrency: 3, sleep: async () => {} });
    expect(put).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
