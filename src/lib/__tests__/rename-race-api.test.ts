// API-level end-to-end test for the rename race. Runs entirely in Node
// (no browser binaries) and simulates the exact wire pattern that used to
// resurrect the old slug: a debounced ydoc_state upsert fires AFTER
// prepareRename → finalizeRename. With the abandoned-slug guard in
// SupabaseYjsProvider, the upsert path used by a still-mounted provider
// must be a no-op for the old slug.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { prepareRename, finalizeRename } from "../rename";
import { getSnapshotDebounceMs, SupabaseYjsProvider, unabandonProviderForSlug } from "../yjs/provider";

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
        eq: (_f: string, slug: string) => ({
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
        eq: (_f: string, slug: string) => {
          rows.delete(slug);
          return Promise.resolve({ error: null });
        },
      }),
    }),
    functions: { invoke: () => Promise.resolve({ error: null }) },
    channel: () => ({
      on: () => ({ on: () => ({ on: () => ({ subscribe: () => Promise.resolve("SUBSCRIBED") }) }) }),
    }),
    removeChannel: () => {},
  },
}));

vi.mock("@/lib/recent-notes", () => ({ renamePinned: vi.fn(), renameRecent: vi.fn() }));
vi.mock("@/lib/share-tokens", () => ({ renameShareToken: vi.fn() }));

describe("rename race (API-level, no browser)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rows.clear();
    upserts.length = 0;
    rows.set("old-slug", {
      slug: "old-slug",
      ydoc_state: "seed",
      content: "hello",
      char_count: 5,
      tags: [],
      is_encrypted: false,
      enc_salt: null,
      enc_check: null,
      enc_iterations: 100000,
    });
  });

  afterEach(() => {
    unabandonProviderForSlug("old-slug");
    vi.useRealTimers();
  });

  it("late debounced snapshot after finalizeRename does not resurrect old slug", async () => {
    const doc = new Y.Doc();
    const provider = new SupabaseYjsProvider("old-slug", doc);
    const providerLogs: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      providerLogs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    doc.getText("content").insert(0, "hello world");

    await prepareRename("old-slug", "new-slug");
    const finalized = finalizeRename("old-slug", "new-slug");
    await vi.advanceTimersByTimeAsync(getSnapshotDebounceMs() + 2_000);
    await expect(finalized).resolves.toEqual({ deletionConfirmed: true });

    // Simulate a debounced snapshot writer firing AFTER finalizeRename.
    await provider.saveSnapshot();
    await vi.advanceTimersByTimeAsync(1_000);

    try {
      expect(rows.has("old-slug")).toBe(false);
      expect(upserts.some((u) => u.slug === "old-slug" && "ydoc_state" in u)).toBe(false);
    } catch (assertionErr) {
      // Persist diagnostics as CI artifacts so failures are debuggable.
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const outDir = path.resolve(process.cwd(), "test-results", "rename-race-api");
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(
          path.join(outDir, "db-snapshot.json"),
          JSON.stringify({ rows: Array.from(rows.entries()), upserts }, null, 2),
        );
        fs.writeFileSync(path.join(outDir, "provider.log"), providerLogs.join("\n"));
      } catch {
        /* best-effort */
      }
      throw assertionErr;
    } finally {
      console.warn = origWarn;
      await provider.destroy();
    }
  });
});

  it("provider marked abandoned immediately stops queueing updates and snapshots", async () => {
    const doc = new Y.Doc();
    const provider = new SupabaseYjsProvider("abandon-test", doc);
    
    // 1) Mark as abandoned
    provider.markAbandoned();
    
    // 2) Try to update
    doc.getText("content").insert(0, "late edit");
    
    // 3) Manually trigger saveSnapshot
    await provider.saveSnapshot();
    
    // 4) Assert no upsert happened for this slug
    expect(upserts.some((u) => u.slug === "abandon-test")).toBe(false);
    
    await provider.destroy();
  });
