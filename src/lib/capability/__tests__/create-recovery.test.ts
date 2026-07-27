import { describe, expect, it } from "vitest";
import {
  clearCreateRecovery,
  loadOrCreateOwnerCandidate,
} from "../create-recovery";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("secure-note create recovery", () => {
  it("durably reuses the exact 32-byte owner candidate until navigation succeeds", () => {
    const storage = memoryStorage();
    const first = loadOrCreateOwnerCandidate("daily", storage);
    const second = loadOrCreateOwnerCandidate("daily", storage);

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toBe(first);
    clearCreateRecovery("daily", first, storage);
    expect(loadOrCreateOwnerCandidate("daily", storage)).not.toBe(first);
  });

  it("fails closed when durable storage is denied", () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error("denied"); };
    expect(() => loadOrCreateOwnerCandidate("daily", storage))
      .toThrow("secure note recovery unavailable");
  });
});
