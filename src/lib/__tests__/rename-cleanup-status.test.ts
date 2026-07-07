import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOldSlugCleanupStatus, getLocalOldSlugCleanupSignals } from "../rename-cleanup-status";

const mocks = vi.hoisted(() => ({
  functionsInvoke: vi.fn(),
  maybeSingle: vi.fn(),
  isProviderSlugAbandoned: vi.fn(),
  isDocCached: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mocks.functionsInvoke },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  },
}));

vi.mock("@/lib/yjs/provider", () => ({
  isProviderSlugAbandoned: mocks.isProviderSlugAbandoned,
}));

vi.mock("@/lib/yjs/doc-cache", () => ({
  isDocCached: mocks.isDocCached,
}));

describe("old slug cleanup status", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.functionsInvoke.mockReset();
    mocks.maybeSingle.mockReset();
    mocks.isProviderSlugAbandoned.mockReset().mockReturnValue(true);
    mocks.isDocCached.mockReset().mockReturnValue(false);
  });

  it("collects local Yjs/IndexedDB cleanup signals for a slug", () => {
    localStorage.setItem(
      "syrin:slug-cleanup:old-slug",
      JSON.stringify({ cleanupStartedAt: 100, indexedDbClearedAt: 200, snapshotsClearedAt: 300 }),
    );
    sessionStorage.setItem("note-snapshot:old-slug", "stale");

    expect(getLocalOldSlugCleanupSignals("old-slug")).toEqual({
      providerAbandoned: true,
      docCacheWarm: false,
      sessionSnapshotPresent: true,
      indexedDbCleared: true,
      cleanupStartedAt: 100,
      indexedDbClearedAt: 200,
      snapshotsClearedAt: 300,
    });
  });

  it("sends local cleanup signals to the cleanup-status endpoint", async () => {
    mocks.functionsInvoke.mockResolvedValueOnce({
      data: {
        slug: "old-slug",
        source: "edge-function",
        database: { rowPresent: false, row: null },
        clientSignals: { providerAbandoned: true, docCacheWarm: false },
        cleaned: true,
      },
      error: null,
    });

    const status = await fetchOldSlugCleanupStatus("old-slug");

    expect(status.cleaned).toBe(true);
    expect(mocks.functionsInvoke).toHaveBeenCalledWith("old-slug-cleanup-status", {
      body: expect.objectContaining({
        slug: "old-slug",
        clientSignals: expect.objectContaining({
          providerAbandoned: true,
          docCacheWarm: false,
          sessionSnapshotPresent: false,
        }),
      }),
    });
  });

  it("falls back to a direct database status when the endpoint is unavailable", async () => {
    mocks.functionsInvoke.mockResolvedValueOnce({ data: null, error: new Error("not deployed") });
    mocks.maybeSingle.mockResolvedValueOnce({
      data: { slug: "old-slug", char_count: 12, updated_at: "now", ydoc_state: "abcd", content: "hello" },
      error: null,
    });

    const status = await fetchOldSlugCleanupStatus("old-slug");

    expect(status.source).toBe("direct-db-fallback");
    expect(status.database.rowPresent).toBe(true);
    expect(status.database.row?.ydoc_state_len).toBe(4);
    expect(status.cleaned).toBe(false);
  });
});