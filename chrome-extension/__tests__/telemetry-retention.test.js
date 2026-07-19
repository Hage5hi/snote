import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TELEMETRY_KEY = "syrin:telemetry";
const DAY_MS = 24 * 60 * 60 * 1000;

function installChrome(initialEvents) {
  const values = { [TELEMETRY_KEY]: initialEvents };
  const local = {
    get: vi.fn((defaults, callback) => {
      const result = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (Object.hasOwn(values, key)) result[key] = values[key];
      }
      callback(result);
    }),
    set: vi.fn((next) => Object.assign(values, next)),
    remove: vi.fn((key) => delete values[key]),
  };

  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: "1.3.5" }) },
    storage: {
      local,
      onChanged: { addListener: vi.fn() },
    },
  };

  return { local, values };
}

describe("local telemetry retention", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.chrome;
  });

  it("removes events older than seven days when diagnostics read telemetry", async () => {
    const now = Date.now();
    const old = { t: now - 7 * DAY_MS - 1, event: "expired" };
    const fresh = { t: now - 7 * DAY_MS, event: "fresh" };
    const { local, values } = installChrome([old, fresh]);
    const { readTelemetry } = await import("../lib/telemetry.js");

    await expect(readTelemetry()).resolves.toEqual([fresh]);
    expect(values[TELEMETRY_KEY]).toEqual([fresh]);
    expect(local.set).toHaveBeenCalledWith({ [TELEMETRY_KEY]: [fresh] });
  });

  it("drops expired events before appending a new event", async () => {
    const expired = { t: Date.now() - 8 * DAY_MS, event: "expired" };
    const { values } = installChrome([expired]);
    const { recordTelemetry } = await import("../lib/telemetry.js");

    recordTelemetry("handshake_ok");

    expect(values[TELEMETRY_KEY]).toHaveLength(1);
    expect(values[TELEMETRY_KEY][0]).toMatchObject({
      t: Date.now(),
      event: "handshake_ok",
      extVersion: "1.3.5",
    });
  });
});
