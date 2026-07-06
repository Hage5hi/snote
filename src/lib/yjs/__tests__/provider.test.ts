import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { SupabaseYjsProvider, type Encryption } from "../provider";

// Capture upsert calls so saveSnapshot tests can assert payloads.
const upsertCalls: Array<Record<string, unknown>> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: (payload: Record<string, unknown>) => {
        upsertCalls.push(payload);
        return Promise.resolve({ error: null });
      },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    channel: () => ({ on: () => ({ on: () => ({ on: () => ({ subscribe: () => Promise.resolve("SUBSCRIBED") }) }) }) }),
    removeChannel: () => {},
  },
}));

// Polyfill rAF for jsdom — flush on next microtask tick.
beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
  }) as typeof requestAnimationFrame;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeProvider() {
  const doc = new Y.Doc();
  const p = new SupabaseYjsProvider("test-slug", doc);
  // Wire the doc update handler ourselves (connect() would do this, but it
  // needs a live Supabase channel which we deliberately skip in unit tests).
  doc.on("update", (p as unknown as { handleDocUpdate: (u: Uint8Array, o: unknown) => void }).handleDocUpdate);
  return { provider: p, doc };
}


describe("SupabaseYjsProvider — Phase 2.5 broadcast batching", () => {
  it("batches multiple updates into 1 broadcast per rAF", async () => {
    const { provider, doc } = makeProvider();
    const text = doc.getText("content");
    // 30 separate Y.Doc transactions → 30 handleDocUpdate calls.
    for (let i = 0; i < 30; i++) {
      text.insert(text.length, "a");
    }
    expect(provider.getUpdateCount()).toBe(30);
    expect(provider.getBroadcastCount()).toBe(0); // not flushed yet
    // Flush rAF.
    await new Promise((r) => setTimeout(r, 5));
    expect(provider.getBroadcastCount()).toBe(1);
  });

  it("eager-flushes at MAX_PENDING_UPDATES (50) to bound memory", async () => {
    const { provider, doc } = makeProvider();
    const text = doc.getText("content");
    // 100 updates → 1 eager flush at 50, 1 eager flush at 100 (50 more
    // arrive synchronously, hitting the threshold again before rAF).
    for (let i = 0; i < 100; i++) {
      text.insert(text.length, "a");
    }
    expect(provider.getUpdateCount()).toBe(100);
    // Two eager flushes triggered synchronously inside the loop.
    expect(provider.getBroadcastCount()).toBe(2);
    // No additional rAF flush since queue is empty.
    await new Promise((r) => setTimeout(r, 5));
    expect(provider.getBroadcastCount()).toBe(2);
  });
});

describe("SupabaseYjsProvider — SyncEvent lifecycle", () => {
  it("emits 'offline' to subscribed listeners", () => {
    const { provider } = makeProvider();
    const events: string[] = [];
    provider.onSyncEvent((e) => events.push(e.type));
    (provider as unknown as { emitSync: (e: { type: string }) => void }).emitSync({ type: "offline" });
    expect(events).toContain("offline");
  });

  it("emits 'online' to subscribed listeners", () => {
    const { provider } = makeProvider();
    const events: string[] = [];
    provider.onSyncEvent((e) => events.push(e.type));
    (provider as unknown as { emitSync: (e: { type: string }) => void }).emitSync({ type: "online" });
    expect(events).toContain("online");
  });

  it("emits 'error' with message payload", () => {
    const { provider } = makeProvider();
    const events: { type: string; message?: string }[] = [];
    provider.onSyncEvent((e) => events.push({ type: e.type, message: (e as { message?: string }).message }));
    (provider as unknown as { emitSync: (e: { type: string; message: string }) => void })
      .emitSync({ type: "error", message: "upsert failed" });
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect(err?.message).toBe("upsert failed");
  });

  it("unsubscribe stops further deliveries", () => {
    const { provider } = makeProvider();
    const events: string[] = [];
    const unsub = provider.onSyncEvent((e) => events.push(e.type));
    unsub();
    (provider as unknown as { emitSync: (e: { type: string }) => void }).emitSync({ type: "offline" });
    expect(events).toHaveLength(0);
  });
});
