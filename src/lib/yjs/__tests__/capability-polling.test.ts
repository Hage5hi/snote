import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilityPollingController,
  nextDelay,
  POLL_HIDDEN_MS,
  POLL_MAX_BACKOFF_MS,
  POLL_VISIBLE_MS,
} from "../capability-polling";

type Listener = (event: Event) => void;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function eventHarness() {
  let hidden = false;
  const windowListeners = new Map<string, Set<Listener>>();
  const documentListeners = new Map<string, Set<Listener>>();
  const add = (listeners: Map<string, Set<Listener>>, type: string, listener: Listener) => {
    const registered = listeners.get(type) ?? new Set<Listener>();
    registered.add(listener);
    listeners.set(type, registered);
  };
  const remove = (listeners: Map<string, Set<Listener>>, type: string, listener: Listener) => {
    listeners.get(type)?.delete(listener);
  };
  const emit = (listeners: Map<string, Set<Listener>>, type: string) => {
    for (const listener of listeners.get(type) ?? []) listener(new Event(type));
  };
  const eventTarget = {
    addEventListener: vi.fn((type: string, listener: Listener) => add(windowListeners, type, listener)),
    removeEventListener: vi.fn((type: string, listener: Listener) => remove(windowListeners, type, listener)),
  } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
  const documentTarget = {
    get visibilityState() { return hidden ? "hidden" : "visible"; },
    addEventListener: vi.fn((type: string, listener: Listener) => add(documentListeners, type, listener)),
    removeEventListener: vi.fn((type: string, listener: Listener) => remove(documentListeners, type, listener)),
  } as unknown as Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;

  return {
    eventTarget,
    documentTarget,
    isHidden: () => hidden,
    setHidden: (value: boolean) => { hidden = value; },
    emitWindow: (type: string) => emit(windowListeners, type),
    emitDocument: (type: string) => emit(documentListeners, type),
  };
}

describe("CapabilityPollingController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses jittered visible and hidden intervals with a cap before jitter", () => {
    expect(POLL_VISIBLE_MS).toBe(2_000);
    expect(POLL_HIDDEN_MS).toBe(10_000);
    expect(POLL_MAX_BACKOFF_MS).toBe(30_000);
    expect(nextDelay({ hidden: false, failures: 0, random: () => 0.5 })).toBe(2_000);
    expect(nextDelay({ hidden: true, failures: 0, random: () => 0.5 })).toBe(10_000);
    expect(nextDelay({ hidden: false, failures: 8, random: () => 0.5 })).toBe(30_000);
    expect(nextDelay({ hidden: false, failures: 0, random: () => 0 })).toBe(1_700);
    expect(nextDelay({ hidden: false, failures: 0, random: () => 1 })).toBe(2_300);
    expect(nextDelay({ hidden: true, failures: 0, random: () => 0 })).toBe(8_500);
    expect(nextDelay({ hidden: true, failures: 0, random: () => 1 })).toBe(11_500);
  });

  it("backs off failed polls and resets to the visible interval after a success", async () => {
    const events = eventHarness();
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    const controller = new CapabilityPollingController({
      run,
      isHidden: events.isHidden,
      random: () => 0.5,
      eventTarget: events.eventTarget,
      documentTarget: events.documentTarget,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);
    controller.stop();
  });

  it("honors a server Retry-After without letting wake events bypass it", async () => {
    const events = eventHarness();
    const limited = Object.assign(new Error("rate limited"), { retryAfterMs: 60_000 });
    const run = vi.fn()
      .mockRejectedValueOnce(limited)
      .mockResolvedValueOnce(undefined);
    const controller = new CapabilityPollingController({
      run,
      isHidden: events.isHidden,
      random: () => 0.5,
      eventTarget: events.eventTarget,
      documentTarget: events.documentTarget,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(2_000);
    events.emitWindow("online");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("coalesces overlapping triggers into exactly one follow-up run", async () => {
    const events = eventHarness();
    const first = deferred<void>();
    const run = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const controller = new CapabilityPollingController({
      run,
      isHidden: events.isHidden,
      random: () => 0.5,
      eventTarget: events.eventTarget,
      documentTarget: events.documentTarget,
    });

    controller.start();
    controller.trigger();
    controller.trigger();
    expect(run).toHaveBeenCalledOnce();

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("immediately catches up on focus, online, and becoming visible", async () => {
    const events = eventHarness();
    const run = vi.fn(async () => {});
    const controller = new CapabilityPollingController({
      run,
      isHidden: events.isHidden,
      random: () => 0.5,
      eventTarget: events.eventTarget,
      documentTarget: events.documentTarget,
    });

    controller.start();
    events.emitWindow("focus");
    await vi.advanceTimersByTimeAsync(0);
    events.emitWindow("online");
    await vi.advanceTimersByTimeAsync(0);
    events.setHidden(true);
    events.emitDocument("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    events.setHidden(false);
    events.emitDocument("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(3);
    controller.stop();
  });

  it("removes listeners, cancels timers, and suppresses future work when stopped", async () => {
    const events = eventHarness();
    const run = vi.fn(async () => {});
    const controller = new CapabilityPollingController({
      run,
      isHidden: events.isHidden,
      random: () => 0.5,
      eventTarget: events.eventTarget,
      documentTarget: events.documentTarget,
    });

    controller.start();
    expect(vi.getTimerCount()).toBe(1);

    controller.stop();
    events.emitWindow("focus");
    events.emitWindow("online");
    events.emitDocument("visibilitychange");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(events.eventTarget.removeEventListener).toHaveBeenCalledTimes(2);
    expect(events.documentTarget.removeEventListener).toHaveBeenCalledOnce();
  });

  it("does not schedule a follow-up when stopped during an active poll", async () => {
    const events = eventHarness();
    const active = deferred<void>();
    const run = vi.fn(() => active.promise);
    const controller = new CapabilityPollingController({
      run,
      isHidden: events.isHidden,
      random: () => 0.5,
      eventTarget: events.eventTarget,
      documentTarget: events.documentTarget,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledOnce();

    controller.trigger();
    controller.stop();
    active.resolve();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(run).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(events.eventTarget.removeEventListener).toHaveBeenCalledTimes(2);
    expect(events.documentTarget.removeEventListener).toHaveBeenCalledOnce();
  });

  it("resumes cadence when restarted while a prior poll is still resolving", async () => {
    const events = eventHarness();
    const active = deferred<void>();
    const run = vi.fn()
      .mockImplementationOnce(() => active.promise)
      .mockResolvedValue(undefined);
    const controller = new CapabilityPollingController({
      run,
      isHidden: events.isHidden,
      random: () => 0.5,
      eventTarget: events.eventTarget,
      documentTarget: events.documentTarget,
    });

    controller.start();
    controller.trigger();
    expect(run).toHaveBeenCalledOnce();

    controller.stop();
    controller.start();
    active.resolve();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(run).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("does not let an older successful poll erase a newer external Retry-After", async () => {
    const events = eventHarness();
    const active = deferred<void>();
    const run = vi.fn()
      .mockImplementationOnce(() => active.promise)
      .mockResolvedValue(undefined);
    const controller = new CapabilityPollingController({
      run,
      isHidden: events.isHidden,
      random: () => 0.5,
      eventTarget: events.eventTarget,
      documentTarget: events.documentTarget,
    });

    controller.start();
    controller.trigger();
    expect(run).toHaveBeenCalledOnce();

    controller.reportExternalFailure(Object.assign(new Error("rate limited"), {
      retryAfterMs: 60_000,
    }));
    active.resolve();
    await vi.advanceTimersByTimeAsync(0);
    events.emitWindow("online");
    await vi.advanceTimersByTimeAsync(59_999);

    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    controller.stop();
  });
});
