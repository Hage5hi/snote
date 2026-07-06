// Guards the S3 retry helper's fail-fast contract: on a non-transient
// error (e.g. 403 AccessDenied, InvalidArgument, NoSuchBucket), the caller
// must see the original error message *immediately* — no retries, no
// backoff sleep, no swallowing of the provider text.
import { describe, expect, it, vi } from "vitest";
import { putObjectWithRetry } from "../ci/s3-upload-with-retry";

describe("putObjectWithRetry — non-transient errors", () => {
  it("does not retry and surfaces the original provider message verbatim", async () => {
    const sleep = vi.fn(async () => {});
    const put = vi.fn(async () => {
      throw Object.assign(new Error("Access Denied: user lacks s3:PutObject"), {
        name: "AccessDenied", $metadata: { httpStatusCode: 403 },
      });
    });
    await expect(
      putObjectWithRetry("my/key", "body", put, { sleep, logRetries: false }),
    ).rejects.toMatchObject({
      name: "AccessDenied",
      message: "Access Denied: user lacks s3:PutObject",
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    ["InvalidArgument", 400],
    ["NoSuchBucket", 404],
    ["EntityTooLarge", 400],
  ])("fails fast for %s (HTTP %i)", async (name, status) => {
    const put = vi.fn(async () => {
      throw Object.assign(new Error(`${name}: fatal`), {
        name, $metadata: { httpStatusCode: status },
      });
    });
    await expect(
      putObjectWithRetry("k", "b", put, { sleep: async () => {}, logRetries: false }),
    ).rejects.toMatchObject({ name, message: `${name}: fatal` });
    expect(put).toHaveBeenCalledTimes(1);
  });
});
