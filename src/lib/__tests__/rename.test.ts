import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { clearRenamedSlugLocalState, prepareRename, finalizeRename } from "../rename";
import { acquireDoc, __docCacheInternals as docCache } from "../yjs/doc-cache";
import { SupabaseYjsProvider, unabandonProviderForSlug } from "../yjs/provider";

type NoteRow = {
  slug: string;
  ydoc_state: string;
  content: string;
  char_count: number;
  tags: string[];
  is_encrypted: boolean;
  enc_salt: string | null;
  enc_check: string | null;
  enc_iterations: number;
};

const rows = new Map<string, NoteRow>();
const upserts: Array<Record<string, unknown>> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_field: string, slug: string) => ({
          maybeSingle: () => Promise.resolve({ data: rows.get(slug) ?? null, error: null }),
        }),
      }),
      upsert: (payload: Record<string, unknown>) => {
        upserts.push(payload);
        const row = {
          ydoc_state: "",
          content: "",
          char_count: 0,
          tags: [],
          is_encrypted: false,
          enc_salt: null,
          enc_check: null,
          enc_iterations: 100000,
          ...payload,
        } as NoteRow;
        rows.set(row.slug, row);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: (_field: string, slug: string) => {
          rows.delete(slug);
          return Promise.resolve({ error: null });
        },
      }),
    }),
    functions: { invoke: () => Promise.resolve({ error: null }) },
    channel: () => ({ on: () => ({ on: () => ({ on: () => ({ subscribe: () => Promise.resolve("SUBSCRIBED") }) }) }) }),
    removeChannel: () => {},
  },
}));

vi.mock("@/lib/recent-notes", () => ({
  renamePinned: vi.fn(),
  renameRecent: vi.fn(),
}));

vi.mock("@/lib/share-tokens", () => ({
  renameShareToken: vi.fn(),
}));

const clearDataMock = vi.fn(() => Promise.resolve());
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: vi.fn().mockImplementation(() => ({
    clearData: clearDataMock,
  })),
}));

vi.mock("@/lib/snapshots", () => ({
  clearSnapshots: vi.fn(() => Promise.resolve()),
}));

function makeProvider(slug: string) {
  const doc = new Y.Doc();
  const provider = new SupabaseYjsProvider(slug, doc);
  doc.on("update", (provider as unknown as { handleDocUpdate: (u: Uint8Array, o: unknown) => void }).handleDocUpdate);
  return { doc, provider };
}

describe("rename lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, "indexedDB", {
      value: {},
      configurable: true,
    });
    docCache.reset();
    sessionStorage.clear();
    clearDataMock.mockClear();
    rows.clear();
    upserts.length = 0;
    rows.set("old-slug", {
      slug: "old-slug",
      ydoc_state: "seed-state",
      content: "seed content",
      char_count: 12,
      tags: [],
      is_encrypted: false,
      enc_salt: null,
      enc_check: null,
      enc_iterations: 100000,
    });
  });

  afterEach(() => {
    unabandonProviderForSlug("old-slug");
    docCache.reset();
    vi.useRealTimers();
  });

  it("abandons the old provider, cancels pending snapshots, and does not recreate the old slug", async () => {
    const { doc, provider } = makeProvider("old-slug");
    const saveSpy = vi.spyOn(provider, "saveSnapshot");
    doc.getText("content").insert(0, "pending local edit");

    await prepareRename("old-slug", "new-slug");
    await provider.destroy();

    const finalized = finalizeRename("old-slug", "new-slug");
    await vi.advanceTimersByTimeAsync(800);
    await expect(finalized).resolves.toEqual({ deletionConfirmed: true });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(rows.has("old-slug")).toBe(false);
    expect(rows.get("new-slug")?.content).toBe("seed content");
    expect(upserts.filter((row) => row.slug === "old-slug")).toHaveLength(0);
  });

  it("keeps deleting a late old-slug resurrection during the debounce confirmation window", async () => {
    await prepareRename("old-slug", "new-slug");

    const finalized = finalizeRename("old-slug", "new-slug");
    await vi.advanceTimersByTimeAsync(850);
    rows.set("old-slug", {
      slug: "old-slug",
      ydoc_state: "late-state",
      content: "late content",
      char_count: 12,
      tags: [],
      is_encrypted: false,
      enc_salt: null,
      enc_check: null,
      enc_iterations: 100000,
    });
    await vi.advanceTimersByTimeAsync(1_200);

    await expect(finalized).resolves.toEqual({ deletionConfirmed: true });
    expect(rows.has("old-slug")).toBe(false);
  });

  it("clears local Yjs/IndexedDB/session state for the old slug during rename", async () => {
    acquireDoc("old-slug").getText("content").insert(0, "cached old content");
    sessionStorage.setItem("note-snapshot:old-slug", "stale-state");

    await clearRenamedSlugLocalState("old-slug");

    expect(docCache.isWarm("old-slug")).toBe(false);
    expect(sessionStorage.getItem("note-snapshot:old-slug")).toBeNull();
    expect(clearDataMock).toHaveBeenCalledTimes(1);
  });
});