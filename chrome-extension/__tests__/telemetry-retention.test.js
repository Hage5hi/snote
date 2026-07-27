import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TELEMETRY_KEY = "syrin:telemetry";
const ENABLED_KEY = "syrin:telemetryEnabled";
const DAY_MS = 24 * 60 * 60 * 1000;

function installChrome(initialEvents, telemetryEnabled) {
  const values = { [TELEMETRY_KEY]: initialEvents };
  if (telemetryEnabled !== undefined) values[ENABLED_KEY] = telemetryEnabled;
  const local = {
    get: vi.fn((defaults, callback) => {
      const result = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (Object.hasOwn(values, key)) result[key] = values[key];
      }
      callback(result);
    }),
    set: vi.fn((next, callback) => {
      Object.assign(values, next);
      callback?.();
    }),
    remove: vi.fn((key, callback) => {
      delete values[key];
      callback?.();
    }),
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

function installDeferredSharedChrome(initialValues) {
  const values = { ...initialValues };
  const listeners = [];
  const pendingChanges = [];
  const pendingTelemetrySets = [];
  let holdTelemetrySets = false;

  const queueChanges = (nextValues, previousValues) => {
    const changes = {};
    for (const key of new Set([
      ...Object.keys(previousValues),
      ...Object.keys(nextValues),
    ])) {
      if (Object.is(previousValues[key], nextValues[key])) continue;
      changes[key] = {
        oldValue: previousValues[key],
        newValue: nextValues[key],
      };
    }
    if (Object.keys(changes).length > 0) pendingChanges.push(changes);
  };

  const commitSet = (next, callback) => {
    const previous = { ...values };
    Object.assign(values, next);
    queueChanges(values, previous);
    callback?.();
  };

  const local = {
    get: vi.fn((defaults, callback) => {
      const result = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (Object.hasOwn(values, key)) result[key] = values[key];
      }
      callback(result);
    }),
    set: vi.fn((next, callback) => {
      if (holdTelemetrySets && Object.hasOwn(next, TELEMETRY_KEY)) {
        pendingTelemetrySets.push(() => commitSet(next, callback));
        return;
      }
      commitSet(next, callback);
    }),
    remove: vi.fn((keyOrKeys, callback) => {
      const previous = { ...values };
      for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) {
        delete values[key];
      }
      queueChanges(values, previous);
      callback?.();
    }),
  };

  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: "1.3.5" }) },
    storage: {
      local,
      onChanged: {
        addListener: vi.fn((listener) => listeners.push(listener)),
      },
    },
  };

  return {
    values,
    holdTelemetryWrites() {
      holdTelemetrySets = true;
    },
    releaseNextTelemetryWrite() {
      const commit = pendingTelemetrySets.shift();
      expect(commit).toBeTypeOf("function");
      commit();
    },
    pendingTelemetryWriteCount() {
      return pendingTelemetrySets.length;
    },
    flushStorageChanges() {
      while (pendingChanges.length > 0) {
        const changes = pendingChanges.shift();
        for (const listener of [...listeners]) listener(changes, "local");
      }
    },
  };
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

  it("defaults first-install telemetry to off and records nothing", async () => {
    const { values } = installChrome([]);
    const { isTelemetryEnabled, readTelemetryEnabledAsync, recordTelemetry } =
      await import("../lib/telemetry.js");

    expect(isTelemetryEnabled()).toBe(false);
    await expect(readTelemetryEnabledAsync()).resolves.toBe(false);
    recordTelemetry("handshake-ok");
    expect(values[TELEMETRY_KEY]).toBeUndefined();
  });

  it("preserves an explicitly stored telemetry opt-in", async () => {
    const { values } = installChrome([], true);
    const { isTelemetryEnabled, readTelemetryEnabledAsync, recordTelemetry } =
      await import("../lib/telemetry.js");

    expect(isTelemetryEnabled()).toBe(true);
    await expect(readTelemetryEnabledAsync()).resolves.toBe(true);
    recordTelemetry("handshake-ok");
    expect(values[TELEMETRY_KEY]).toHaveLength(1);
  });

  it("never persists raw runtime locators or attacker-controlled telemetry strings", async () => {
    const slug = "sentinel-telemetry-private-slug";
    const token = "sentinel-telemetry-token";
    const fullUrl = `https://note.syrin.online/s/${token}/${slug}?token=${token}`;
    const { values } = installChrome([], true);
    const { recordTelemetry } = await import("../lib/telemetry.js");

    recordTelemetry("handshake-ok", {
      appBuildId: slug,
      retryCount: 2,
      detail: {
        appProtocol: 2,
        appVersion: "9.9.9",
        reason: fullUrl,
        url: fullUrl,
      },
    });

    const serialized = JSON.stringify(values[TELEMETRY_KEY]);
    expect(serialized).not.toContain(slug);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(fullUrl);
    expect(values[TELEMETRY_KEY][0]).toMatchObject({
      event: "handshake-ok",
      appBuildId: "<redacted>",
      retryCount: 2,
      detail: {
        appProtocol: 2,
        appVersion: "9.9.9",
        reason: "<redacted>",
      },
    });
    expect(values[TELEMETRY_KEY][0].detail).not.toHaveProperty("url");
  });

  it("rejects syntactically valid version strings above the diagnostics size cap", async () => {
    const oversizedVersion = `1.0.0-${"a".repeat(59)}`;
    const { values } = installChrome([], true);
    const { recordTelemetry } = await import("../lib/telemetry.js");

    recordTelemetry("handshake-ok", {
      detail: { appVersion: oversizedVersion },
    });

    expect(oversizedVersion).toHaveLength(65);
    expect(values[TELEMETRY_KEY][0].detail.appVersion).toBe("unknown");
    expect(JSON.stringify(values[TELEMETRY_KEY])).not.toContain(oversizedVersion);
  });

  it("removes events older than seven days when diagnostics read telemetry", async () => {
    const now = Date.now();
    const old = { t: now - 7 * DAY_MS - 1, event: "expired" };
    const fresh = { t: now - 7 * DAY_MS, event: "fresh" };
    const { local, values } = installChrome([old, fresh], true);
    const { readTelemetry } = await import("../lib/telemetry.js");

    const sanitizedFresh = {
      t: fresh.t,
      event: "unknown",
      extVersion: "unknown",
      appBuildId: null,
      retryCount: 0,
      detail: {},
    };
    await expect(readTelemetry()).resolves.toEqual([sanitizedFresh]);
    expect(values[TELEMETRY_KEY]).toEqual([sanitizedFresh]);
    expect(local.set).toHaveBeenCalledWith(
      expect.objectContaining({ [TELEMETRY_KEY]: [sanitizedFresh] }),
      expect.any(Function),
    );
  });

  it("sanitizes telemetry written by older extension versions before returning it", async () => {
    const sentinel = "sentinel-legacy-private-locator";
    const raw = {
      t: Date.now(),
      event: `legacy-${sentinel}`,
      extVersion: sentinel,
      appBuildId: sentinel,
      retryCount: 1,
      detail: { reason: sentinel, url: `https://note.syrin.online/s/${sentinel}` },
    };
    const { values } = installChrome([raw], true);
    const { readTelemetry } = await import("../lib/telemetry.js");

    const events = await readTelemetry();
    expect(JSON.stringify(events)).not.toContain(sentinel);
    expect(JSON.stringify(values[TELEMETRY_KEY])).not.toContain(sentinel);
    expect(events[0]).toMatchObject({
      event: "unknown",
      extVersion: "unknown",
      appBuildId: "<redacted>",
      detail: { reason: "<redacted>" },
    });
    expect(events[0].detail).not.toHaveProperty("url");
  });

  it("does not let a pending append resurrect telemetry after opt-out", async () => {
    let telemetryGet;
    let storageListener;
    let telemetryReadCount = 0;
    const local = {
      get: vi.fn((defaults, callback) => {
        if (Object.hasOwn(defaults, TELEMETRY_KEY)) {
          telemetryReadCount += 1;
          if (telemetryReadCount === 1) {
            callback({ ...defaults, [ENABLED_KEY]: true, [TELEMETRY_KEY]: [] });
            return;
          }
          telemetryGet = callback;
          return;
        }
        callback({ ...defaults, [ENABLED_KEY]: true });
      }),
      set: vi.fn(),
      remove: vi.fn((_key, callback) => callback?.()),
    };
    globalThis.chrome = {
      runtime: { getManifest: () => ({ version: "1.3.5" }) },
      storage: {
        local,
        onChanged: { addListener: vi.fn((listener) => { storageListener = listener; }) },
      },
    };
    const { recordTelemetry } = await import("../lib/telemetry.js");
    recordTelemetry("handshake-ok");
    expect(telemetryGet).toBeTypeOf("function");

    storageListener({ [ENABLED_KEY]: { oldValue: true, newValue: false } }, "local");
    telemetryGet({ [TELEMETRY_KEY]: [], [ENABLED_KEY]: false });

    expect(local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ [TELEMETRY_KEY]: expect.any(Array) }),
    );
  });

  it("does not let a pending append resurrect telemetry after clear", async () => {
    let telemetryGet;
    let telemetryReadCount = 0;
    const values = { [ENABLED_KEY]: true, [TELEMETRY_KEY]: [] };
    const local = {
      get: vi.fn((defaults, callback) => {
        telemetryReadCount += 1;
        if (telemetryReadCount === 1) {
          callback({ ...defaults, ...values });
          return;
        }
        telemetryGet = callback;
      }),
      set: vi.fn((next, callback) => {
        Object.assign(values, next);
        callback?.();
      }),
      remove: vi.fn((key, callback) => {
        delete values[key];
        callback?.();
      }),
    };
    globalThis.chrome = {
      runtime: { getManifest: () => ({ version: "1.3.5" }) },
      storage: { local, onChanged: { addListener: vi.fn() } },
    };
    const { clearTelemetry, recordTelemetry } = await import("../lib/telemetry.js");
    recordTelemetry("handshake-ok");
    expect(telemetryGet).toBeTypeOf("function");

    await expect(clearTelemetry()).resolves.toBe(true);
    telemetryGet({ [TELEMETRY_KEY]: [], [ENABLED_KEY]: true });

    expect(values[TELEMETRY_KEY]).toBeUndefined();
  });

  it("does not let an append from another extension realm commit after clear", async () => {
    const storage = installDeferredSharedChrome({
      [ENABLED_KEY]: true,
      [TELEMETRY_KEY]: [],
    });
    const realmA = await import("../lib/telemetry.js");
    vi.resetModules();
    const realmB = await import("../lib/telemetry.js");

    storage.holdTelemetryWrites();
    realmA.recordTelemetry("handshake-ok");
    expect(storage.pendingTelemetryWriteCount()).toBe(1);

    await expect(realmB.clearTelemetry()).resolves.toBe(true);
    storage.flushStorageChanges();
    storage.releaseNextTelemetryWrite();
    storage.flushStorageChanges();

    expect(storage.values[TELEMETRY_KEY]).toBeUndefined();
  });

  it("does not let an append from another extension realm commit after opt-out", async () => {
    const storage = installDeferredSharedChrome({
      [ENABLED_KEY]: true,
      [TELEMETRY_KEY]: [],
    });
    const realmA = await import("../lib/telemetry.js");
    vi.resetModules();
    const realmB = await import("../lib/telemetry.js");

    storage.holdTelemetryWrites();
    realmA.recordTelemetry("handshake-ok");
    expect(storage.pendingTelemetryWriteCount()).toBe(1);

    realmB.setTelemetryEnabled(false);
    storage.flushStorageChanges();
    storage.releaseNextTelemetryWrite();
    storage.flushStorageChanges();

    expect(storage.values[ENABLED_KEY]).toBe(false);
    expect(storage.values[TELEMETRY_KEY]).toBeUndefined();
  });

  it("does not let a pending read migration resurrect telemetry after cross-realm clear", async () => {
    const storage = installDeferredSharedChrome({
      [ENABLED_KEY]: true,
      [TELEMETRY_KEY]: [],
    });
    const realmA = await import("../lib/telemetry.js");
    vi.resetModules();
    const realmB = await import("../lib/telemetry.js");
    storage.values[TELEMETRY_KEY] = [{
      t: Date.now(),
      event: "legacy-private-event",
      detail: { reason: "legacy-private-detail" },
    }];

    storage.holdTelemetryWrites();
    const pendingRead = realmA.readTelemetry();
    expect(storage.pendingTelemetryWriteCount()).toBe(1);

    await expect(realmB.clearTelemetry()).resolves.toBe(true);
    storage.flushStorageChanges();
    storage.releaseNextTelemetryWrite();
    storage.flushStorageChanges();

    await pendingRead;
    expect(storage.values[TELEMETRY_KEY]).toBeUndefined();
  });

  it("does not let a pending initialization migration resurrect telemetry after clear", async () => {
    const storage = installDeferredSharedChrome({
      [ENABLED_KEY]: true,
      [TELEMETRY_KEY]: [],
    });
    const clearingRealm = await import("../lib/telemetry.js");
    storage.values[TELEMETRY_KEY] = [{
      t: Date.now(),
      event: "legacy-private-event",
      detail: { reason: "legacy-private-detail" },
    }];

    storage.holdTelemetryWrites();
    vi.resetModules();
    await import("../lib/telemetry.js");
    expect(storage.pendingTelemetryWriteCount()).toBe(1);

    await expect(clearingRealm.clearTelemetry()).resolves.toBe(true);
    storage.flushStorageChanges();
    storage.releaseNextTelemetryWrite();
    storage.flushStorageChanges();

    expect(storage.values[TELEMETRY_KEY]).toBeUndefined();
  });

  it("purges retained legacy events on upgrade when no opt-in exists", async () => {
    const sentinel = "sentinel-prechange-raw-locator";
    const { local, values } = installChrome([
      { t: Date.now(), event: sentinel, detail: { reason: sentinel } },
    ]);

    await import("../lib/telemetry.js");

    expect(local.remove).toHaveBeenCalledWith(TELEMETRY_KEY, expect.any(Function));
    expect(values[TELEMETRY_KEY]).toBeUndefined();
  });

  it("drops expired events before appending a new event", async () => {
    const expired = { t: Date.now() - 8 * DAY_MS, event: "expired" };
    const { values } = installChrome([expired], true);
    const { recordTelemetry } = await import("../lib/telemetry.js");

    recordTelemetry("handshake-ok");

    expect(values[TELEMETRY_KEY]).toHaveLength(1);
    expect(values[TELEMETRY_KEY][0]).toMatchObject({
      t: Date.now(),
      event: "handshake-ok",
      extVersion: "1.3.5",
    });
  });
});
