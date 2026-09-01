const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

// Retired: this name used to be an unauthenticated service-role dump of note
// bytes. Keep the function name as a generic uncacheable 410 so leftover
// callers cannot recover note bytes. Production serves this 410 tombstone
// (verified 2026-09-02). Do not restore a dump.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ found: false }, 405);
  }
  return jsonResponse({ found: false }, 410);
});
