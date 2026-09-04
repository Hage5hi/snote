import { CAPABILITY_TOKEN_RE, buildCapabilityUrl } from "./url";
import { newOwnerCandidate } from "./encoding";
import { isUsableSlug } from "@/lib/slug";

const PENDING_PREFIX = "snote:pending-owner:";

export type PendingOwnerStore = {
  load: (slug: string) => string | null;
  save: (slug: string, owner: string) => void;
  clear: (slug: string) => void;
};

export type MintFailureKind =
  | "slug_unavailable"
  | "rate_limited"
  | "unavailable"
  | "retry";

export type MintFailure = {
  kind: MintFailureKind;
  status: number | null;
  retryAfterMs: number | null;
};

function pendingKey(slug: string): string {
  return `${PENDING_PREFIX}${slug}`;
}

function browserPendingStore(): PendingOwnerStore {
  if (typeof sessionStorage === "undefined") throw new Error("pending owner unavailable");
  const storage = sessionStorage;
  return {
    load(slug) {
      const raw = storage.getItem(pendingKey(slug));
      return raw && CAPABILITY_TOKEN_RE.test(raw) ? raw : null;
    },
    save(slug, owner) {
      const key = pendingKey(slug);
      storage.setItem(key, owner);
      if (storage.getItem(key) !== owner) throw new Error("pending owner unavailable");
    },
    clear(slug) {
      storage.removeItem(pendingKey(slug));
    },
  };
}

export function loadPendingOwnerCandidate(
  slug: string,
  store?: PendingOwnerStore,
): string | null {
  if (!isUsableSlug(slug)) return null;
  try {
    return (store ?? browserPendingStore()).load(slug);
  } catch {
    return null;
  }
}

export function persistPendingOwnerCandidate(
  slug: string,
  owner: string,
  store?: PendingOwnerStore,
): void {
  if (!isUsableSlug(slug)) throw new Error("invalid slug");
  if (!CAPABILITY_TOKEN_RE.test(owner)) throw new Error("invalid capability");
  (store ?? browserPendingStore()).save(slug, owner);
}

export function clearPendingOwnerCandidate(
  slug: string,
  store?: PendingOwnerStore,
): void {
  try {
    (store ?? browserPendingStore()).clear(slug);
  } catch {
    // The owner is already in the fragment after a successful mint.
  }
}

export function ownerFragmentPath(slug: string, owner: string): string {
  const canonical = buildCapabilityUrl("owner", owner, slug);
  const url = new URL(canonical);
  if (url.search) throw new Error("invalid capability url");
  return `${url.pathname}${url.hash}`;
}

function readCapabilityFailure(error: unknown): {
  status: number | null;
  code: string | null;
  retryAfterMs: number | null;
} {
  if (!error || typeof error !== "object") {
    return { status: null, code: null, retryAfterMs: null };
  }
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    retryAfterMs?: unknown;
  };
  const status = typeof candidate.status === "number" && Number.isSafeInteger(candidate.status)
    ? candidate.status
    : null;
  const code = typeof candidate.code === "string" && /^[a-z][a-z_]{0,63}$/.test(candidate.code)
    ? candidate.code
    : null;
  const retryAfterMs = typeof candidate.retryAfterMs === "number"
    && Number.isSafeInteger(candidate.retryAfterMs)
    ? candidate.retryAfterMs
    : null;
  return { status, code, retryAfterMs };
}

export function mapMintFailure(error: unknown): MintFailure {
  const { status, code, retryAfterMs } = readCapabilityFailure(error);
  if (code === "slug_unavailable") {
    return { kind: "slug_unavailable", status: status ?? 409, retryAfterMs };
  }
  if (code === "rate_limited" || status === 429) {
    return { kind: "rate_limited", status: status ?? 429, retryAfterMs };
  }
  if (code === "writes_disabled" || code === "unavailable" || status === 503) {
    return { kind: "unavailable", status: status ?? 503, retryAfterMs };
  }
  return { kind: "retry", status, retryAfterMs };
}

export async function mintCapabilityNote(
  slug: string,
  createNote: (slug: string, ownerCandidate: string) => Promise<{
    capabilities: { owner: string };
  }>,
  options: { store?: PendingOwnerStore } = {},
): Promise<{ owner: string; path: string }> {
  if (!isUsableSlug(slug)) throw new Error("invalid slug");
  const store = options.store ?? browserPendingStore();
  let owner = loadPendingOwnerCandidate(slug, store);
  if (!owner) {
    owner = newOwnerCandidate();
    persistPendingOwnerCandidate(slug, owner, store);
  }
  const created = await createNote(slug, owner);
  if (created.capabilities.owner !== owner) throw new Error("invalid capabilities");
  return { owner, path: ownerFragmentPath(slug, owner) };
}
