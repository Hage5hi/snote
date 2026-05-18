import { describe, it, expect } from "vitest";
import { deriveStatus, type DeriveStatusInput } from "../use-sync-status";

const base: DeriveStatusInput = {
  offline: false,
  lastErrorMessage: null,
  conflictPending: false,
  pendingBytes: 0,
  lastBroadcastAt: 0,
};

describe("deriveStatus", () => {
  it("returns 'offline' when offline flag true", () => {
    expect(deriveStatus({ ...base, offline: true })).toBe("offline");
  });

  it("returns 'error' when lastErrorMessage set", () => {
    expect(deriveStatus({ ...base, lastErrorMessage: "oops" })).toBe("error");
  });

  it("returns 'conflict' when conflictPending true", () => {
    expect(deriveStatus({ ...base, conflictPending: true })).toBe("conflict");
  });

  it("returns 'syncing' when pendingBytes > 0", () => {
    expect(deriveStatus({ ...base, pendingBytes: 100 })).toBe("syncing");
  });

  it("returns 'syncing' within broadcast window of last broadcast", () => {
    const now = 1_000_000;
    expect(
      deriveStatus({ ...base, lastBroadcastAt: now - 100 }, now),
    ).toBe("syncing");
  });

  it("returns 'synced' when no signal active and broadcast window elapsed", () => {
    const now = 1_000_000;
    expect(deriveStatus(base, now)).toBe("synced");
    expect(
      deriveStatus({ ...base, lastBroadcastAt: now - 60_000 }, now),
    ).toBe("synced");
  });

  it("priority order: offline > error > conflict > syncing", () => {
    const allActive: DeriveStatusInput = {
      offline: true,
      lastErrorMessage: "err",
      conflictPending: true,
      pendingBytes: 100,
      lastBroadcastAt: Date.now(),
    };
    expect(deriveStatus(allActive)).toBe("offline");
    expect(deriveStatus({ ...allActive, offline: false })).toBe("error");
    expect(deriveStatus({ ...allActive, offline: false, lastErrorMessage: null })).toBe("conflict");
    expect(
      deriveStatus({ ...allActive, offline: false, lastErrorMessage: null, conflictPending: false }),
    ).toBe("syncing");
  });
});
