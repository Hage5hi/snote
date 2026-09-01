const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
      "cache-control": "no-store",
      "cdn-cache-control": "no-store",
    },
  });
}

// Retired: this name used to be a service-role plaintext dump keyed by a
// public locator. Keep the function deployed as a generic uncacheable 410 so
// leftover callers cannot recover note bytes. The editor path reads
// public.notes directly and does not need this endpoint.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") {
    return jsonResponse({ found: false }, 405);
  }
  return jsonResponse({ found: false }, 410);
});
