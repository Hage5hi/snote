import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { prepareRename, finalizeRename } from "../rename";
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

function makeProvider(slug: string) {
  const doc = new Y.Doc();
  const provider = new SupabaseYjsProvider(slug, doc);
  doc.on("update", (provider as unknown as { handleDocUpdate: (u: Uint8Array, o: unknown) => void }).handleDocUpdate);
  return { doc, provider };
}

describe("rename lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  it("abandons the old provider, cancels pending snapshots, and does not recreate the old slug", async () => {
    const { doc, provider } = makeProvider("old-slug");
    const saveSpy = vi.spyOn(provider, "saveSnapshot");
    doc.getText("content").insert(0, "pending local edit");

    await prepareRename("old-slug", "new-slug");
    await provider.destroy();

    const finalized = finalizeRename("old-slug", "new-slug");
    await vi.advanceTimersByTimeAsync(750);
    await expect(finalized).resolves.toEqual({ deletionConfirmed: true });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(rows.has("old-slug")).toBe(false);
    expect(rows.get("new-slug")?.content).toBe("seed content");
    expect(upserts.filter((row) => row.slug === "old-slug")).toHaveLength(0);
  });
});