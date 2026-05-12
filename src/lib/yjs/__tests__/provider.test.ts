import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { SupabaseYjsProvider } from "../provider";

// Mock Supabase client — provider only touches it inside connect()/saveSnapshot,
// neither of which we exercise here. The import must not throw.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ upsert: () => ({ then: () => {} }), select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
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
  // Pretend channel is open so broadcastUpdate doesn't early-return.
  // We don't care about actual send — flushBroadcasts increments the counter
  // before broadcastUpdate runs.
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
