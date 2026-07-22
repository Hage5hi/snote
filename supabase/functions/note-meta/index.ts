const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-meta-secret",
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

// Legacy locator metadata carried content previews and public cache directives.
// Until capability URLs replace edit locators, every lookup is deliberately
// generic and uncacheable so plaintext cannot survive a later lock/revoke.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") {
    return jsonResponse({ found: false }, 405);
  }
  return jsonResponse({ found: false }, 410);
});
