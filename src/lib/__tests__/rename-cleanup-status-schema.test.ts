// Contract tests for OldSlugCleanupStatusSchema. Covers payloads with
// missing/late fields (e.g. null char_count/updated_at, absent metrics)
// and verifies the direct-DB fallback path is used when the edge-function
// payload is malformed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OldSlugCleanupStatusSchema,
  fetchOldSlugCleanupStatus,
} from "../rename-cleanup-status";

const mocks = vi.hoisted(() => ({
  functionsInvoke: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mocks.functionsInvoke },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  },
}));
vi.mock("@/lib/yjs/provider", () => ({ isProviderSlugAbandoned: () => true }));
vi.mock("@/lib/yjs/doc-cache", () => ({ isDocCached: () => false }));

describe("OldSlugCleanupStatusSchema", () => {
  beforeEach(() => {
    mocks.functionsInvoke.mockReset();
    mocks.maybeSingle.mockReset();
    localStorage.clear();
  });

  it("accepts a row with null char_count/updated_at", () => {
    const parsed = OldSlugCleanupStatusSchema.safeParse({
      slug: "s",
      source: "edge-function",
      database: {
        rowPresent: true,
        row: { slug: "s", char_count: null, updated_at: null, ydoc_state_len: 0, content_len: 0 },
      },
      clientSignals: {},
      cleaned: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts payloads without metrics (older function versions)", () => {
    const parsed = OldSlugCleanupStatusSchema.safeParse({
      slug: "s",
      source: "edge-function",
      database: { rowPresent: false, row: null },
      clientSignals: { providerAbandoned: true },
      cleaned: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts and preserves metrics when present", () => {
    const parsed = OldSlugCleanupStatusSchema.safeParse({
      slug: "s",
      source: "edge-function",
      database: { rowPresent: false, row: null },
      clientSignals: {},
      cleaned: false,
      metrics: { dbMs: 12, totalMs: 34 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.metrics).toEqual({ dbMs: 12, totalMs: 34 });
  });

  it("rejects malformed payload missing database field", () => {
    const parsed = OldSlugCleanupStatusSchema.safeParse({
      slug: "s",
      source: "edge-function",
      clientSignals: {},
      cleaned: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("falls back to direct-DB when edge-function payload is malformed", async () => {
    mocks.functionsInvoke.mockResolvedValueOnce({
      data: { slug: "s", wrong: "shape" },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const status = await fetchOldSlugCleanupStatus("s");
    expect(status.source).toBe("direct-db-fallback");
    expect(status.database.rowPresent).toBe(false);
  });
});
