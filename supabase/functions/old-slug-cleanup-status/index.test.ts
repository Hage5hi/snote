// Contract tests for the old-slug-cleanup-status edge function.
// Validates payload shape, slug validation, and cleaned-flag semantics
// across all combinations of Yjs/IndexedDB client signals.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/old-slug-cleanup-status`;

async function call(body: unknown, method = "POST") {
  const res = await fetch(FN_URL, {
    method,
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: json as Record<string, unknown> | null, raw: text };
}

Deno.test("rejects non-POST methods", async () => {
  const r = await call({}, "GET");
  assertEquals(r.status, 405);
});

Deno.test("rejects invalid slug shape", async () => {
  for (const bad of ["", "has space", "way-too-long-".repeat(10), "bad/char"]) {
    const r = await call({ slug: bad });
    assertEquals(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    assertEquals((r.body as { error: string }).error, "invalid slug");
  }
});

Deno.test("returns contract-shaped payload with all client signal fields", async () => {
  const slug = `contract-test-${Date.now()}`;
  const clientSignals = {
    providerAbandoned: true,
    docCacheWarm: false,
    sessionSnapshotPresent: false,
    indexedDbCleared: true,
    cleanupStartedAt: 1,
    indexedDbClearedAt: 2,
    snapshotsClearedAt: 3,
  };
  const r = await call({ slug, clientSignals });
  assertEquals(r.status, 200);
  const body = r.body!;
  assertEquals(body.slug, slug);
  assertEquals(body.source, "edge-function");
  const db = body.database as { rowPresent: boolean; row: unknown };
  assertExists(db);
  assertEquals(typeof db.rowPresent, "boolean");
  assertEquals(db.rowPresent, false);
  assertEquals(db.row, null);
  const echoed = body.clientSignals as Record<string, unknown>;
  for (const k of Object.keys(clientSignals)) {
    assertEquals(echoed[k], (clientSignals as Record<string, unknown>)[k], `signal ${k} lost`);
  }
  assertEquals(body.cleaned, true);
});

Deno.test("cleaned=false when provider not abandoned or caches warm", async () => {
  const base = `contract-dirty-${Date.now()}`;
  const cases = [
    { providerAbandoned: false, docCacheWarm: false, sessionSnapshotPresent: false },
    { providerAbandoned: true, docCacheWarm: true, sessionSnapshotPresent: false },
    { providerAbandoned: true, docCacheWarm: false, sessionSnapshotPresent: true },
  ];
  for (const [i, cs] of cases.entries()) {
    const r = await call({ slug: `${base}-${i}`, clientSignals: cs });
    assertEquals(r.status, 200);
    assertEquals(r.body!.cleaned, false, `case ${i} should be dirty`);
  }
});

Deno.test("missing clientSignals still returns well-formed payload", async () => {
  const r = await call({ slug: `contract-nosig-${Date.now()}` });
  assertEquals(r.status, 200);
  assertExists(r.body!.database);
  assertEquals(typeof (r.body!.database as { rowPresent: boolean }).rowPresent, "boolean");
  assertExists(r.body!.clientSignals);
  assertEquals(r.body!.cleaned, false);
});
