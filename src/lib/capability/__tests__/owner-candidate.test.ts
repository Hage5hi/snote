import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityApiError, createCapabilityApi } from "../client";
import { newOwnerCandidate } from "../encoding";
import {
  clearPendingOwnerCandidate,
  loadPendingOwnerCandidate,
  mapMintFailure,
  mintCapabilityNote,
  ownerFragmentPath,
  persistPendingOwnerCandidate,
  type PendingOwnerStore,
} from "../owner-candidate";
import { CAPABILITY_TOKEN_RE } from "../url";

const env = import.meta.env as Record<string, unknown>;
const TOKEN = "b".repeat(43);
const NOTE_ID = "00000000-0000-4000-8000-000000000001";

function memoryStore(initial: string | null = null): PendingOwnerStore & {
  value: string | null;
  load: ReturnType<typeof vi.fn<(slug: string) => string | null>>;
  save: ReturnType<typeof vi.fn<(slug: string, owner: string) => void>>;
  clear: ReturnType<typeof vi.fn<(slug: string) => void>>;
} {
  const store = {
    value: initial as string | null,
    load: vi.fn<(slug: string) => string | null>(() => store.value),
    save: vi.fn<(slug: string, owner: string) => void>((_slug, owner) => {
      store.value = owner;
    }),
    clear: vi.fn<(slug: string) => void>(() => {
      store.value = null;
    }),
  };
  return store;
}

const POLLING_SESSION = {
  noteId: NOTE_ID,
  slug: "daily",
  scope: "owner",
  realtimeTopic: `note:${NOTE_ID}`,
  generation: 1,
  syncStatus: "active",
  currentSequence: 0,
  payloadLimitBytes: 4_194_304,
  checkpointSequence: 0,
  checkpointVersion: null,
  checkpointPayload: null,
  checkpointEncryptionVersion: null,
  missingUpdates: [],
  encryption: {
    enabled: false,
    version: 0,
    salt: null,
    check: null,
    iterations: 600_000,
  },
  syncTransport: "polling",
  realtimeToken: null,
  realtimeExpiresAt: null,
};

describe("pending owner candidate", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("persists a valid owner in sessionStorage keyed by slug, never recents", () => {
    persistPendingOwnerCandidate("daily", TOKEN);

    expect(loadPendingOwnerCandidate("daily")).toBe(TOKEN);
    expect(sessionStorage.getItem("snote:pending-owner:daily")).toBe(TOKEN);
    expect(localStorage.getItem("note.recents")).toBeNull();
    expect(localStorage.getItem("note.pinned")).toBeNull();
    expect(JSON.stringify(sessionStorage)).not.toContain("?");
  });

  it("rejects an unusable slug before touching storage", () => {
    expect(() => persistPendingOwnerCandidate("note", TOKEN)).toThrow("invalid slug");
    expect(sessionStorage.getItem("snote:pending-owner:note")).toBeNull();
  });

  it("builds an origin-relative owner fragment without query or path token", () => {
    const path = ownerFragmentPath("daily", TOKEN);
    expect(path).toBe(`/daily#owner=${TOKEN}`);
    expect(path).not.toContain("?");
    expect(path.split("#")[0]).not.toContain(TOKEN);
    expect(path).not.toContain("https://");
  });
});

describe("mintCapabilityNote", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("persists the owner candidate before createNote and returns the fragment path", async () => {
    const store = memoryStore();
    const createNote = vi.fn(async (_slug: string, owner: string) => ({
      capabilities: { owner },
    }));

    const minted = await mintCapabilityNote("daily", createNote, { store });

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(store.save.mock.invocationCallOrder[0])
      .toBeLessThan(createNote.mock.invocationCallOrder[0]);
    expect(minted.owner).toMatch(CAPABILITY_TOKEN_RE);
    expect(minted.owner).toBe(createNote.mock.calls[0][1]);
    expect(minted.path).toBe(`/daily#owner=${minted.owner}`);
    expect(store.value).toBe(minted.owner);
  });

  it("retries a lost create with the same persisted owner candidate", async () => {
    const store = memoryStore();
    const createNote = vi.fn()
      .mockRejectedValueOnce(new Error("network lost after commit"))
      .mockImplementationOnce(async (_slug: string, owner: string) => ({
        capabilities: { owner },
      }));

    await expect(mintCapabilityNote("daily", createNote, { store }))
      .rejects.toThrow("network lost");
    const recovered = await mintCapabilityNote("daily", createNote, { store });

    expect(createNote).toHaveBeenCalledTimes(2);
    expect(createNote.mock.calls[1]).toEqual(createNote.mock.calls[0]);
    expect(recovered.owner).toBe(createNote.mock.calls[0][1]);
    expect(recovered.path).toBe(`/daily#owner=${recovered.owner}`);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("does not call createNote for an invalid slug", async () => {
    const createNote = vi.fn();
    await expect(mintCapabilityNote("Privacy", createNote)).rejects.toThrow("invalid slug");
    expect(createNote).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("does not write recents or pins while minting", async () => {
    const createNote = vi.fn(async (_slug: string, owner: string) => ({
      capabilities: { owner },
    }));
    await mintCapabilityNote("daily", createNote);
    expect(localStorage.getItem("note.recents")).toBeNull();
    expect(localStorage.getItem("note.pinned")).toBeNull();
    const owner = createNote.mock.calls[0][1];
    expect(JSON.stringify(localStorage)).not.toContain(owner);
  });
});

describe("mapMintFailure", () => {
  it("maps slug_unavailable to 409 without treating other 409s as taken", () => {
    expect(mapMintFailure(new CapabilityApiError("slug unavailable", 409, null, "slug_unavailable")))
      .toEqual({ kind: "slug_unavailable", status: 409, retryAfterMs: null });
    expect(mapMintFailure(new CapabilityApiError("version conflict", 409, null, "version_conflict")))
      .toEqual({ kind: "retry", status: 409, retryAfterMs: null });
  });

  it("maps admission rate limits to 429 and keeps Retry-After", () => {
    expect(mapMintFailure(new CapabilityApiError(
      "capacity temporarily exceeded",
      429,
      3_600_000,
      "rate_limited",
    ))).toEqual({ kind: "rate_limited", status: 429, retryAfterMs: 3_600_000 });
  });

  it("maps writes_disabled / unavailable / 503 to unavailable", () => {
    expect(mapMintFailure(new CapabilityApiError(
      "temporarily unavailable",
      503,
      null,
      "writes_disabled",
    ))).toEqual({ kind: "unavailable", status: 503, retryAfterMs: null });
    expect(mapMintFailure(new CapabilityApiError("temporarily unavailable", 503, null, "unavailable")))
      .toEqual({ kind: "unavailable", status: 503, retryAfterMs: null });
    expect(mapMintFailure(new CapabilityApiError("temporarily unavailable", 503, null, null)))
      .toEqual({ kind: "unavailable", status: 503, retryAfterMs: null });
  });

  it("maps network and invalid capabilities to retry", () => {
    expect(mapMintFailure(new Error("network lost"))).toEqual({
      kind: "retry",
      status: null,
      retryAfterMs: null,
    });
    expect(mapMintFailure(new Error("invalid capabilities"))).toEqual({
      kind: "retry",
      status: null,
      retryAfterMs: null,
    });
  });
});

describe("createNote recover contract", () => {
  let previousRoutesFlag: unknown;

  beforeEach(() => {
    previousRoutesFlag = env.VITE_CAPABILITY_ROUTES_ENABLED;
    env.VITE_CAPABILITY_ROUTES_ENABLED = "true";
    sessionStorage.clear();
  });

  afterEach(() => {
    env.VITE_CAPABILITY_ROUTES_ENABLED = previousRoutesFlag;
    sessionStorage.clear();
  });

  it("POSTs note-session create with Bearer owner and recovers 200 with the same candidate", async () => {
    const owner = newOwnerCandidate();
    persistPendingOwnerCandidate("daily", owner);
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://project.supabase.co/functions/v1/note-session");
      expect(String(input)).not.toContain(owner);
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner}`,
      });
      expect(JSON.parse(String(init?.body))).toEqual({ action: "create", slug: "daily" });
      expect(String(init?.body)).not.toContain(owner);
      if (fetcher.mock.calls.length === 1) {
        return Promise.reject(new TypeError("network lost after 201"));
      }
      return Response.json({
        session: POLLING_SESSION,
        capabilities: { owner },
      }, { status: 200 });
    });
    const api = createCapabilityApi({
      baseUrl: "https://project.supabase.co",
      fetcher,
      authSource: { accessTokenFor: vi.fn(async () => null) },
    });

    await expect(mintCapabilityNote("daily", (slug, candidate) => api.createNote(slug, candidate)))
      .rejects.toThrow("network lost");
    const recovered = await mintCapabilityNote(
      "daily",
      (slug, candidate) => api.createNote(slug, candidate),
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(recovered.owner).toBe(owner);
    expect(recovered.path).toBe(`/daily#owner=${owner}`);
    expect(loadPendingOwnerCandidate("daily")).toBe(owner);
    clearPendingOwnerCandidate("daily");
    expect(loadPendingOwnerCandidate("daily")).toBeNull();
  });
});
