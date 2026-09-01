// Retired: this unauthenticated observer used the service role to resolve a
// locator, returned note metadata, and logged raw old/new slugs. Capability
// cutover replaces it; immediate containment must reveal no locator state.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: "endpoint retired" }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
