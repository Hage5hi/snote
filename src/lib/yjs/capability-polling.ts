export const POLL_VISIBLE_MS = 2_000;
export const POLL_HIDDEN_MS = 10_000;
export const POLL_MAX_BACKOFF_MS = 30_000;
export const POLL_JITTER_RATIO = 0.15;

export type CapabilityPollingControllerOptions = {
  run: () => Promise<void>;
  isHidden: () => boolean;
  now?: () => number;
  random?: () => number;
  setTimer?: typeof window.setTimeout;
  clearTimer?: typeof window.clearTimeout;
  eventTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget?: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;
};

export type CapabilityPollingDelayOptions = Pick<
  CapabilityPollingControllerOptions,
  "isHidden" | "random"
> & {
  hidden: boolean;
  failures: number;
};

type TimerHandler = Parameters<typeof window.setTimeout>[0];
type TimerSetter = (handler: TimerHandler, timeout?: number) => number;
type TimerClearer = (timer?: number) => void;

const defaultSetTimer: TimerSetter = (handler, timeout) =>
  globalThis.setTimeout(handler, timeout) as unknown as number;
const defaultClearTimer: TimerClearer = (timer) =>
  globalThis.clearTimeout(timer as unknown as ReturnType<typeof globalThis.setTimeout>);

function boundedRandom(random: () => number) {
  const value = random();
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

function retryAfterFrom(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

export function nextDelay({ hidden, failures, random = Math.random }: Omit<
  CapabilityPollingDelayOptions,
  "isHidden"
>): number {
  const base = hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
  const count = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0;
  const capped = Math.min(
    POLL_MAX_BACKOFF_MS,
    base * 2 ** Math.min(count, 30),
  );
  const jitter = 1 - POLL_JITTER_RATIO + boundedRandom(random) * (POLL_JITTER_RATIO * 2);
  return Math.round(capped * jitter);
}

/**
 * A small polling scheduler that treats a wake-up as a request for one durable
 * catch-up rather than permission to overlap network requests. The caller owns
 * error classification; rejected runs are retried with capped, jittered backoff.
 */
export class CapabilityPollingController {
  private readonly runTask: () => Promise<void>;
  private readonly isHidden: () => boolean;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: TimerSetter;
  private readonly clearTimer: TimerClearer;
  private readonly eventTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  private readonly documentTarget?: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;
  private started = false;
  private running = false;
  private followUp = false;
  private failures = 0;
  private externalFailureEpoch = 0;
  private retryNotBefore = 0;
  private timer: number | null = null;
  private lifecycle = 0;

  constructor(options: CapabilityPollingControllerOptions) {
    this.runTask = options.run;
    this.isHidden = options.isHidden;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer
      ? (handler, timeout) => options.setTimer!(handler, timeout)
      : defaultSetTimer;
    this.clearTimer = options.clearTimer
      ? (timer) => options.clearTimer!(timer)
      : defaultClearTimer;
    this.eventTarget = options.eventTarget
      ?? (typeof window === "undefined" ? undefined : window);
    this.documentTarget = options.documentTarget
      ?? (typeof document === "undefined" ? undefined : document);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.lifecycle += 1;
    this.eventTarget?.addEventListener("focus", this.handleWake);
    this.eventTarget?.addEventListener("online", this.handleWake);
    this.documentTarget?.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.scheduleNext();
  }

  trigger() {
    if (!this.started) return;
    this.clearScheduledTimer();
    if (this.isCoolingDown()) {
      this.scheduleNext();
      return;
    }
    if (this.running) {
      this.followUp = true;
      return;
    }
    void this.run(this.lifecycle);
  }

  recordSuccess() {
    this.failures = 0;
    this.retryNotBefore = 0;
  }

  recordFailure(retryAfterMs?: number | null) {
    this.failures = Math.min(this.failures + 1, 30);
    const serverDelay = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.floor(retryAfterMs)
      : 0;
    const localDelay = nextDelay({
      hidden: this.isHidden(),
      failures: this.failures,
      random: this.random,
    });
    this.retryNotBefore = Math.max(this.retryNotBefore, this.now() + Math.max(localDelay, serverDelay));
  }

  /**
   * A direct durable sync may fail outside the scheduled poll loop. Feed that
   * failure into the same cooldown so typing cannot hammer the API while the
   * next catch-up is already deferred.
   */
  reportExternalFailure(error: unknown) {
    if (!this.started) return;
    this.externalFailureEpoch += 1;
    this.recordFailure(retryAfterFrom(error));
    this.clearScheduledTimer();
    this.scheduleNext();
  }

  isCoolingDown() {
    return this.retryNotBefore > this.now();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.lifecycle += 1;
    this.followUp = false;
    this.clearScheduledTimer();
    this.eventTarget?.removeEventListener("focus", this.handleWake);
    this.eventTarget?.removeEventListener("online", this.handleWake);
    this.documentTarget?.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private handleWake = () => this.trigger();

  private handleVisibilityChange = () => {
    if (!this.isHidden()) this.trigger();
  };

  private async run(lifecycle: number) {
    if (!this.started || this.running || lifecycle !== this.lifecycle) return;
    this.running = true;
    const externalFailureEpoch = this.externalFailureEpoch;
    let followUp = false;
    let scheduleNext = false;
    try {
      await this.runTask();
      if (
        this.started
        && lifecycle === this.lifecycle
        && externalFailureEpoch === this.externalFailureEpoch
      ) this.recordSuccess();
    } catch (error) {
      if (this.started && lifecycle === this.lifecycle) {
        this.recordFailure(retryAfterFrom(error));
      }
    } finally {
      this.running = false;
      if (this.started && this.followUp) {
        this.followUp = false;
        followUp = true;
      } else if (this.started) {
        scheduleNext = true;
      }
    }
    if (followUp) this.trigger();
    else if (scheduleNext) this.scheduleNext();
  }

  private scheduleNext() {
    if (!this.started || this.running || this.timer !== null) return;
    const backoffDelay = Math.max(0, this.retryNotBefore - this.now());
    const delay = backoffDelay || nextDelay({
      hidden: this.isHidden(),
      failures: this.failures,
      random: this.random,
    });
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.trigger();
    }, delay);
  }

  private clearScheduledTimer() {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}
