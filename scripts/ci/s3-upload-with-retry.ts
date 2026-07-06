// S3 PutObject helper with exponential-backoff retry + bounded concurrency.
//
// Purpose: preview-build artifact uploads occasionally hit S3
// `ServiceUnavailable` / `SlowDown` / `InternalError` when many
// PutObject calls fan out in parallel. We wrap the caller-supplied
// `putObject` function so it:
//
//   1. retries transient errors with jittered exponential backoff, and
//   2. limits how many PutObject calls are in-flight at once.
//
// The helper is transport-agnostic — it accepts any async
// `(key, body) => Promise<void>` — so it works with the AWS SDK,
// a signed-URL `fetch`, or a mock in tests.

export interface RetryOptions {
  /** Max attempts per object (including the first try). Default 5. */
  maxAttempts?: number;
  /** Initial backoff in ms. Doubles each attempt. Default 200. */
  baseDelayMs?: number;
  /** Cap on any single backoff wait. Default 5_000. */
  maxDelayMs?: number;
  /** RNG for jitter — inject in tests for determinism. */
  random?: () => number;
  /** Sleep — inject in tests to avoid real waits. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry — useful for structured logging in CI. */
  onRetry?: (info: { key: string; attempt: number; delayMs: number; error: unknown }) => void;
}

export interface UploadOptions extends RetryOptions {
  /** Max concurrent PutObject calls. Default 4 (was ~unlimited before). */
  concurrency?: number;
}

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
  "ServiceUnavailable",
  "SlowDown",
  "InternalError",
  "RequestTimeout",
  "ThrottlingException",
  "ProvisionedThroughputExceededException",
]);

export function isTransientS3Error(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number }; status?: number };
  const status = e.$metadata?.httpStatusCode ?? e.status;
  if (typeof status === "number" && TRANSIENT_STATUSES.has(status)) return true;
  const code = e.code ?? e.name;
  return typeof code === "string" && TRANSIENT_CODES.has(code);
}

export async function putObjectWithRetry(
  key: string,
  body: unknown,
  putObject: (key: string, body: unknown) => Promise<void>,
  opts: RetryOptions = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelay = opts.baseDelayMs ?? 200;
  const maxDelay = opts.maxDelayMs ?? 5_000;
  const rand = opts.random ?? Math.random;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await putObject(key, body);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransientS3Error(err)) throw err;
      const exp = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const delayMs = Math.floor(exp * (0.5 + rand() * 0.5)); // 50–100% jitter
      opts.onRetry?.({ key, attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

export async function uploadAllWithRetry(
  entries: ReadonlyArray<{ key: string; body: unknown }>,
  putObject: (key: string, body: unknown) => Promise<void>,
  opts: UploadOptions = {},
): Promise<void> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const runNext = async (): Promise<void> => {
    while (cursor < entries.length) {
      const i = cursor++;
      const { key, body } = entries[i];
      await putObjectWithRetry(key, body, putObject, opts);
    }
  };
  for (let i = 0; i < Math.min(concurrency, entries.length); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);
}
