import { afterEach, describe, expect, it, vi } from "vitest";

import {
  capabilityAuthStorageKey,
  createCapabilityAuthSource,
  type CapabilityAuthOptions,
} from "../auth";

const CAPABILITY_A = "A".repeat(43);
const CAPABILITY_B = "B".repeat(43);
const NOW = 1_800_000_000_000;

type Session = {
  access_token: string;
  expires_at: number;
};

function serialLockManager(): LockManager {
  let tail = Promise.resolve();
  return {
    request: vi.fn((_name: string, callback: () => Promise<unknown>) => {
      const result = tail.then(callback);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    query: vi.fn(),
  } as unknown as LockManager;
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

function authHarness({
  sessions,
  refreshError,
  enabled = true,
  storage = memoryStorage(),
  lockManager = serialLockManager(),
}: {
  sessions?: Record<string, Session | null>;
  refreshError?: { code?: string; message: string };
  enabled?: boolean;
  storage?: Storage;
  lockManager?: LockManager;
} = {}) {
  const sessionByStorageKey = new Map<string, Session | null>();
  const signInAnonymously = vi.fn();
  const refreshSession = vi.fn();
  const signOut = vi.fn((_storageKey: string, _options: unknown) => undefined);
  const getSession = vi.fn();
  const turnstileToken = vi.fn(async () => "captcha-token");
  const clients: string[] = [];
  let signupCount = 0;

  const createAuthClient: NonNullable<CapabilityAuthOptions["createAuthClient"]> = vi.fn(
    (_url, _key, storageKey) => {
      clients.push(storageKey);
      const configured = Object.entries(sessions ?? {}).find(
        ([capability]) => storageKey === sessionByCapability.get(capability),
      )?.[1];
      if (!sessionByStorageKey.has(storageKey)) {
        sessionByStorageKey.set(storageKey, configured ?? null);
      }

      return {
        auth: {
          getSession: vi.fn(async () => {
            getSession(storageKey);
            return {
              data: { session: sessionByStorageKey.get(storageKey) ?? null },
              error: null,
            };
          }),
          refreshSession: vi.fn(async () => {
            refreshSession(storageKey);
            if (refreshError) {
              return { data: { session: null, user: null }, error: refreshError };
            }
            const refreshed = {
              access_token: `refreshed-${storageKey.slice(-6)}`,
              expires_at: (NOW + 3_600_000) / 1000,
            };
            sessionByStorageKey.set(storageKey, refreshed);
            return { data: { session: refreshed, user: {} }, error: null };
          }),
          signInAnonymously: vi.fn(async (credentials) => {
            signInAnonymously(storageKey, credentials);
            signupCount += 1;
            const session = {
              access_token: `access-${signupCount}`,
              expires_at: (NOW + 3_600_000) / 1000,
            };
            sessionByStorageKey.set(storageKey, session);
            return { data: { session, user: {} }, error: null };
          }),
          signOut: vi.fn(async (options) => {
            signOut(storageKey, options);
            sessionByStorageKey.set(storageKey, null);
            return { error: null };
          }),
        } as never,
      };
    },
  );

  const sessionByCapability = new Map<string, string>();
  const prepare = async () => {
    for (const capability of Object.keys(sessions ?? {})) {
      sessionByCapability.set(capability, await capabilityAuthStorageKey(capability));
    }
  };

  const options: CapabilityAuthOptions = {
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "publishable-key",
    enabled,
    turnstile: { token: turnstileToken },
    storage,
    lockManager,
    now: () => NOW,
    createAuthClient,
  };

  return {
    options,
    prepare,
    clients,
    sessionByStorageKey,
    signInAnonymously,
    refreshSession,
    signOut,
    getSession,
    turnstileToken,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capabilityAuthStorageKey", () => {
  it("derives a deterministic partition without the raw capability", async () => {
    const first = await capabilityAuthStorageKey(CAPABILITY_A);
    const second = await capabilityAuthStorageKey(CAPABILITY_A);

    expect(first).toBe(second);
    expect(first).toMatch(/^snote-auth-v1-[a-f0-9]{64}$/);
    expect(first).not.toContain(CAPABILITY_A);
  });

  it("uses distinct partitions for distinct capabilities", async () => {
    await expect(capabilityAuthStorageKey(CAPABILITY_A)).resolves.not.toBe(
      await capabilityAuthStorageKey(CAPABILITY_B),
    );
  });

  it("does not expose an invalid raw capability in errors", async () => {
    const rawCapability = "raw-secret-that-must-not-leak";

    await expect(capabilityAuthStorageKey(rawCapability)).rejects.not.toThrow(rawCapability);
  });
});

describe("createCapabilityAuthSource", () => {
  it("reuses a persisted identity without signup", async () => {
    const harness = authHarness({
      sessions: {
        [CAPABILITY_A]: {
          access_token: "persisted-access",
          expires_at: (NOW + 3_600_000) / 1000,
        },
      },
    });
    await harness.prepare();
    const source = createCapabilityAuthSource(harness.options);

    await expect(source.accessTokenFor(CAPABILITY_A)).resolves.toBe("persisted-access");
    expect(harness.signInAnonymously).not.toHaveBeenCalled();
    expect(harness.turnstileToken).not.toHaveBeenCalled();
  });

  it("coalesces concurrent anonymous signup under the digest lock", async () => {
    const harness = authHarness();
    const source = createCapabilityAuthSource(harness.options);

    await expect(
      Promise.all([
        source.accessTokenFor(CAPABILITY_A),
        source.accessTokenFor(CAPABILITY_A),
      ]),
    ).resolves.toEqual(["access-1", "access-1"]);
    expect(harness.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(harness.turnstileToken).toHaveBeenCalledTimes(1);
  });

  it("uses different Auth clients and users for different capability partitions", async () => {
    const harness = authHarness();
    const source = createCapabilityAuthSource(harness.options);

    const first = await source.accessTokenFor(CAPABILITY_A);
    const second = await source.accessTokenFor(CAPABILITY_B);

    expect(first).toBe("access-1");
    expect(second).toBe("access-2");
    expect(new Set(harness.clients)).toHaveLength(2);
    expect(harness.clients.every((key) => !key.includes(CAPABILITY_A) && !key.includes(CAPABILITY_B)))
      .toBe(true);
  });

  it("cached-only never refreshes, signs in, or calls Turnstile", async () => {
    const harness = authHarness({ sessions: { [CAPABILITY_A]: null } });
    await harness.prepare();
    const source = createCapabilityAuthSource(harness.options);

    await expect(source.accessTokenFor(CAPABILITY_A, "cached-only")).resolves.toBeNull();
    expect(harness.signInAnonymously).not.toHaveBeenCalled();
    expect(harness.refreshSession).not.toHaveBeenCalled();
    expect(harness.turnstileToken).not.toHaveBeenCalled();
  });

  it("cached-only returns only a current unexpired token", async () => {
    const current = authHarness({
      sessions: {
        [CAPABILITY_A]: {
          access_token: "current-access",
          expires_at: (NOW + 10_000) / 1000,
        },
      },
    });
    await current.prepare();
    const expired = authHarness({
      sessions: {
        [CAPABILITY_B]: {
          access_token: "expired-access",
          expires_at: (NOW - 1) / 1000,
        },
      },
    });
    await expired.prepare();

    await expect(
      createCapabilityAuthSource(current.options).accessTokenFor(CAPABILITY_A, "cached-only"),
    ).resolves.toBe("current-access");
    await expect(
      createCapabilityAuthSource(expired.options).accessTokenFor(CAPABILITY_B, "cached-only"),
    ).resolves.toBeNull();
    expect(current.refreshSession).not.toHaveBeenCalled();
    expect(expired.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes a session within 90 seconds of expiry before returning its token", async () => {
    const harness = authHarness({
      sessions: {
        [CAPABILITY_A]: {
          access_token: "nearly-expired-access",
          expires_at: (NOW + 90_000) / 1000,
        },
      },
    });
    await harness.prepare();
    const source = createCapabilityAuthSource(harness.options);

    await expect(source.accessTokenFor(CAPABILITY_A)).resolves.toMatch(/^refreshed-/);
    expect(harness.refreshSession).toHaveBeenCalledOnce();
    expect(harness.signInAnonymously).not.toHaveBeenCalled();
  });

  it("clears only an invalid refresh partition and recreates it with CAPTCHA", async () => {
    const harness = authHarness({
      sessions: {
        [CAPABILITY_A]: {
          access_token: "stale-a",
          expires_at: (NOW + 10_000) / 1000,
        },
        [CAPABILITY_B]: {
          access_token: "healthy-b",
          expires_at: (NOW + 3_600_000) / 1000,
        },
      },
      refreshError: {
        code: "refresh_token_not_found",
        message: "Invalid Refresh Token: Refresh Token Not Found",
      },
    });
    await harness.prepare();
    const source = createCapabilityAuthSource(harness.options);

    await expect(source.accessTokenFor(CAPABILITY_A)).resolves.toBe("access-1");
    await expect(source.accessTokenFor(CAPABILITY_B)).resolves.toBe("healthy-b");
    const partitionA = await capabilityAuthStorageKey(CAPABILITY_A);
    const partitionB = await capabilityAuthStorageKey(CAPABILITY_B);
    expect(harness.signOut).toHaveBeenCalledWith(partitionA, { scope: "local" });
    expect(harness.signOut).not.toHaveBeenCalledWith(partitionB, expect.anything());
    expect(harness.turnstileToken).toHaveBeenCalledOnce();
    expect(harness.signInAnonymously).toHaveBeenCalledWith(partitionA, {
      options: { captchaToken: "captcha-token" },
    });
  });

  it.each([
    ["disabled feature", { enabled: false }],
    ["storage denial", { storage: {
      ...memoryStorage(),
      getItem: vi.fn(() => {
        throw new DOMException("denied", "SecurityError");
      }),
    } as Storage }],
    ["missing LockManager", { lockManager: null as unknown as LockManager }],
  ] as const)("%s returns null when no persisted session exists", async (_name, overrides) => {
    const harness = authHarness(overrides);
    const source = createCapabilityAuthSource(harness.options);

    await expect(source.accessTokenFor(CAPABILITY_A)).resolves.toBeNull();
    expect(harness.signInAnonymously).not.toHaveBeenCalled();
    expect(harness.turnstileToken).not.toHaveBeenCalled();
  });

  it("converts Turnstile and Auth failures to null without logging identifiers", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const harness = authHarness();
    harness.options.turnstile = {
      token: vi.fn(async () => {
        throw new Error(`captcha failed for ${CAPABILITY_A}`);
      }),
    };
    const source = createCapabilityAuthSource(harness.options);

    await expect(source.accessTokenFor(CAPABILITY_A)).resolves.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });
});
