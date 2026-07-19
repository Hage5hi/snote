// Retired: the legacy slug-to-slug migration relied on a public locator as
// authority and used the service role. Capability-backed rename supersedes it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
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

