// Deployed-contract smoke test for the retired observer. It must expose no
// locator-dependent status while legacy slugs remain public table keys.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/old-slug-cleanup-status`;

async function call(body: unknown, method = "POST") {
  const response = await fetch(FN_URL, {
    method,
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    text: await response.text(),
  };
}

Deno.test("returns a generic no-store tombstone without echoing locators", async () => {
  const oldSlug = "sentinel-old-private-slug";
  const newSlug = "sentinel-new-private-slug";
  const result = await call({
    slug: oldSlug,
    newSlug,
    clientSignals: { providerAbandoned: true },
  });

  assertEquals(result.status, 410);
  assertEquals(result.cacheControl, "no-store");
  assertEquals(JSON.parse(result.text), { error: "endpoint retired" });
  assertFalse(result.text.includes(oldSlug));
  assertFalse(result.text.includes(newSlug));
});

Deno.test("does not expose a method-dependent status oracle", async () => {
  const result = await call(undefined, "GET");
  assertEquals(result.status, 410);
  assertEquals(result.cacheControl, "no-store");
  assertEquals(JSON.parse(result.text), { error: "endpoint retired" });
});
