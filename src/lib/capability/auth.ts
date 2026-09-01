import {
  createClient,
  isAuthSessionMissingError,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { CAPABILITY_TOKEN_RE } from "./url";
import {
  createTurnstileTokenSource,
  type TurnstileTokenSource,
} from "./turnstile";

export type CapabilityAuthMode = "ensure" | "cached-only";

export interface CapabilityAuthSource {
  accessTokenFor(
    capability: string,
    mode?: CapabilityAuthMode,
  ): Promise<string | null>;
}

export type CapabilityAuthOptions = {
  supabaseUrl: string;
  publishableKey: string;
  enabled: boolean;
  turnstile: TurnstileTokenSource;
  storage?: Storage;
  lockManager?: LockManager;
  now?: () => number;
  createAuthClient?: (
    url: string,
    key: string,
    storageKey: string,
    storage: Storage,
  ) => Pick<SupabaseClient, "auth">;
};

const STORAGE_PREFIX = "snote-auth-v1";
const REFRESH_WINDOW_MS = 90_000;

type CryptoLike = Pick<Crypto, "subtle">;
type AuthClient = Pick<SupabaseClient, "auth">;

function defaultAuthClient(
  url: string,
  key: string,
  storageKey: string,
  storage: Storage,
): AuthClient {
  return createClient(url, key, {
    auth: {
      storage,
      storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function capabilityAuthStorageKey(
  capability: string,
  cryptoLike: CryptoLike = globalThis.crypto,
): Promise<string> {
  if (!CAPABILITY_TOKEN_RE.test(capability)) {
    throw new Error("invalid capability");
  }
  if (!cryptoLike?.subtle) {
    throw new Error("cryptography unavailable");
  }

  const input = new TextEncoder().encode(`${STORAGE_PREFIX}${capability}`);
  const digest = await cryptoLike.subtle.digest("SHA-256", input);
  return `${STORAGE_PREFIX}-${bytesToHex(digest)}`;
}

function nonemptyToken(session: Session | null): string | null {
  return typeof session?.access_token === "string" && session.access_token.length > 0
    ? session.access_token
    : null;
}

function unexpiredToken(session: Session | null, now: number): string | null {
  const token = nonemptyToken(session);
  if (!token || typeof session?.expires_at !== "number") return null;
  return session.expires_at * 1000 > now ? token : null;
}

function currentTokenOutsideRefreshWindow(
  session: Session | null,
  now: number,
): string | null {
  const token = nonemptyToken(session);
  if (!token || typeof session?.expires_at !== "number") return null;
  return session.expires_at * 1000 - now > REFRESH_WINDOW_MS ? token : null;
}

function isInvalidRefresh(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "refresh_token_not_found"
    || code === "refresh_token_already_used"
    || /invalid refresh token|refresh token not found|refresh token.*deleted/i.test(message);
}

function configuredStorage(storage: Storage | undefined): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function configuredLocks(lockManager: LockManager | undefined): LockManager | null {
  if (lockManager) return lockManager;
  try {
    return typeof navigator === "undefined" ? null : navigator.locks ?? null;
  } catch {
    return null;
  }
}

export function createCapabilityAuthSource(
  options: CapabilityAuthOptions,
): CapabilityAuthSource {
  const clients = new Map<string, AuthClient>();
  const now = options.now ?? Date.now;
  const createAuthClient = options.createAuthClient ?? defaultAuthClient;

  function cachedTokenFromStorage(storageKey: string): string | null {
    const storage = configuredStorage(options.storage);
    if (!storage) return null;

    try {
      const persisted = storage.getItem(storageKey);
      if (!persisted) return null;
      const session: unknown = JSON.parse(persisted);
      if (!session || typeof session !== "object" || Array.isArray(session)) return null;

      const accessToken = "access_token" in session ? session.access_token : null;
      const expiresAt = "expires_at" in session ? session.expires_at : null;
      if (
        typeof accessToken !== "string"
        || accessToken.length === 0
        || typeof expiresAt !== "number"
        || !Number.isFinite(expiresAt)
        || expiresAt * 1000 <= now()
      ) {
        return null;
      }
      return accessToken;
    } catch {
      return null;
    }
  }

  async function clientFor(storageKey: string): Promise<AuthClient | null> {
    const digest = storageKey.slice(`${STORAGE_PREFIX}-`.length);
    const cached = clients.get(digest);
    if (cached) return cached;

    const storage = configuredStorage(options.storage);
    if (!storage) return null;

    try {
      storage.getItem(storageKey);
      const client = createAuthClient(
        options.supabaseUrl,
        options.publishableKey,
        storageKey,
        storage,
      );
      clients.set(digest, client);
      return client;
    } catch {
      return null;
    }
  }

  async function readSession(
    client: AuthClient,
  ): Promise<{ session: Session | null; error: unknown }> {
    try {
      const result = await client.auth.getSession();
      return {
        session: result.data.session,
        error: result.error,
      };
    } catch (error) {
      return { session: null, error };
    }
  }

  async function clearInvalidSession(client: AuthClient): Promise<boolean> {
    try {
      const result = await client.auth.signOut({ scope: "local" });
      return !result.error;
    } catch {
      return false;
    }
  }

  async function refresh(
    client: AuthClient,
  ): Promise<{ token: string | null; recreate: boolean }> {
    try {
      const result = await client.auth.refreshSession();
      if (result.error) {
        if (!isInvalidRefresh(result.error)) return { token: null, recreate: false };
        const cleared = await clearInvalidSession(client);
        return { token: null, recreate: cleared };
      }
      return {
        token: unexpiredToken(result.data.session, now()),
        recreate: false,
      };
    } catch {
      return { token: null, recreate: false };
    }
  }

  async function ensureExisting(
    client: AuthClient,
  ): Promise<{ token: string | null; create: boolean }> {
    const { session, error } = await readSession(client);
    if (error) {
      if (!isInvalidRefresh(error)) return { token: null, create: false };
      const cleared = await clearInvalidSession(client);
      return { token: null, create: cleared };
    }
    if (!session) return { token: null, create: true };

    const current = currentTokenOutsideRefreshWindow(session, now());
    if (current) return { token: current, create: false };

    const refreshed = await refresh(client);
    return {
      token: refreshed.token,
      create: refreshed.recreate,
    };
  }

  async function createIdentity(client: AuthClient): Promise<string | null> {
    let captchaToken: string | null;
    try {
      captchaToken = await options.turnstile.token();
    } catch {
      return null;
    }
    if (!captchaToken) return null;

    try {
      const result = await client.auth.signInAnonymously({
        options: { captchaToken },
      });
      if (result.error) return null;
      return unexpiredToken(result.data.session, now());
    } catch {
      return null;
    }
  }

  return {
    async accessTokenFor(
      capability: string,
      mode: CapabilityAuthMode = "ensure",
    ): Promise<string | null> {
      if (!options.enabled) return null;

      let storageKey: string;
      try {
        storageKey = await capabilityAuthStorageKey(capability);
      } catch {
        return null;
      }

      if (mode === "cached-only") {
        return cachedTokenFromStorage(storageKey);
      }

      const client = await clientFor(storageKey);
      if (!client) return null;

      const existing = await ensureExisting(client);
      if (existing.token || !existing.create) return existing.token;

      const lockManager = configuredLocks(options.lockManager);
      if (!lockManager) return null;
      const digest = storageKey.slice(`${STORAGE_PREFIX}-`.length);

      try {
        return await lockManager.request(
          `snote-auth-lock-${digest}`,
          async () => {
            const lockedExisting = await ensureExisting(client);
            if (lockedExisting.token || !lockedExisting.create) {
              return lockedExisting.token;
            }
            return createIdentity(client);
          },
        );
      } catch {
        return null;
      }
    },
  };
}

let defaultSource: CapabilityAuthSource | undefined;

export function createDefaultCapabilityAuthSource(): CapabilityAuthSource {
  if (!defaultSource) {
    defaultSource = createCapabilityAuthSource({
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
      publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      enabled: import.meta.env.VITE_CAPABILITY_AUTH_ENABLED === "true"
        && import.meta.env.VITE_CAPABILITY_ROUTES_ENABLED === "true",
      turnstile: createTurnstileTokenSource({
        siteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "",
      }),
    });
  }
  return defaultSource;
}
