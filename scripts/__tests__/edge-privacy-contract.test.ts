import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSP =
  "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; " +
  "frame-ancestors 'self' chrome-extension://*; script-src 'self' https://challenges.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://flagcdn.com " +
  "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev; font-src 'self' data:; " +
  "connect-src 'self' https://onfzjmfjldsbthchssfr.supabase.co " +
  "wss://onfzjmfjldsbthchssfr.supabase.co https://challenges.cloudflare.com; " +
  "frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; " +
  "manifest-src 'self'; upgrade-insecure-requests;";
const PERMISSIONS_POLICY =
  "camera=(), geolocation=(), microphone=(), payment=()";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("edge privacy deployment contract", () => {
  it("keeps production and staging Workers isolated, non-observing, and fail-closed", () => {
    const production = source("cloudflare-worker/wrangler.toml");
    const staging = source("cloudflare-worker/wrangler.staging.toml");
    const readme = source("cloudflare-worker/README.md");
    const manifest = source(
      "docs/security/release-manifests/2026-07-capability-rollout.md",
    );

    expect(production).toContain('name = "syrin-prerender-no-go"');
    expect(production).not.toMatch(
      /^name\s*=\s*"syrin-prerender"\s*$/m,
    );
    expect(production).toMatch(/routes\s*=\s*\[\s*\]/);
    expect(production).not.toContain('pattern = "note.syrin.online/*"');
    expect(production).not.toContain('pattern = "syrin.online/*"');
    expect(production).not.toMatch(
      /^ORIGIN_HOST\s*=\s*"snote\.lovable\.app"\s*$/m,
    );
    expect(production).toContain('ORIGIN_HOST = "production-origin.invalid"');
    expect(production).toMatch(/NO-GO/i);
    expect(production).toMatch(/\[observability\]\s+enabled\s*=\s*false/);
    expect(production).toMatch(/workers_dev\s*=\s*false/);

    expect(staging).toContain('name = "syrin-prerender-staging"');
    expect(staging).not.toContain('pattern = "note.syrin.online/*"');
    expect(staging).not.toContain('pattern = "syrin.online/*"');
    expect(staging).toMatch(/\[observability\]\s+enabled\s*=\s*false/);
    expect(readme).toMatch(/NO-GO/i);
    expect(readme).toContain("snote.lovable.app");
    expect(readme).toMatch(/redirect/i);
    expect(readme).toMatch(/chưa hoạt động trên production/i);
    expect(readme).toContain("chỉ là fallback cho static hosting");
    expect(readme).toContain("SSR/Pages Functions");
    expect(manifest).toMatch(/Worker origin:\s*`UNSET`/);
    expect(manifest).toContain(
      "Release candidate SHA: `UNASSIGNED (awaiting a green PR head)`",
    );
    expect(manifest).toContain(
      "Current remote main SHA: `382806e683bc62e843db81fdee66a0b7f0829d5e`",
    );
    expect(manifest).toContain(
      "Observed production build ID: `1785243143966-t3474iba`",
    );
    expect(manifest).not.toContain(
      "- Deployed build ID: `5bfc10bd-bde7-4b47-aebe-5be33d2391c1`",
    );
    expect(manifest).toContain("Historical Lovable-managed backend inventory");
    expect(manifest).toContain(
      "Historical verification snapshot (not a release candidate)",
    );
    expect(manifest).toContain(
      "Historical evidence cutoff SHA: `17577e3581724f5688acaf97ebc6d96d365d93d7`",
    );
    expect(manifest).toContain("does not attest a tested source SHA");
    expect(manifest).toContain(
      "Historical observed application build: `5bfc10bd-bde7-4b47-aebe-5be33d2391c1`",
    );
    expect(manifest).not.toContain(
      "- Deployed application build: `5bfc10bd-bde7-4b47-aebe-5be33d2391c1`",
    );
    expect(manifest).toMatch(/snote\.lovable\.app[\s\S]*redirect/i);
    expect(manifest).toMatch(/non-redirecting origin/i);
  });

  it("keeps fallback hosting headers aligned with the edge policy", () => {
    const vercel = source("vercel.json");
    const headers = source("public/_headers");

    for (const config of [vercel, headers]) {
      expect(config).toContain(CSP);
      expect(config).toContain(PERMISSIONS_POLICY);
      expect(config.toLowerCase()).not.toContain("x-frame-options");
      expect(config).toContain("private, no-store");
      expect(config).toContain("noindex, nofollow, noarchive, nosnippet");
    }
  });

  it("does not mark every asset immutable in fallback hosting configs", () => {
    const vercel = JSON.parse(source("vercel.json")) as {
      headers?: Array<{
        source?: string;
        headers?: Array<{ key?: string; value?: string }>;
      }>;
    };
    const headers = source("public/_headers");
    const blanketVercelAssetRule = vercel.headers?.find(
      (rule) => rule.source === "/assets/(.*)",
    );

    expect(blanketVercelAssetRule?.headers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "Cache-Control",
          value: expect.stringContaining("immutable"),
        }),
      ]),
    );
    expect(headers).not.toMatch(
      /\/assets\/\*\s+[\s\S]*?Cache-Control:\s*[^\r\n]*immutable/i,
    );
  });

  it("keeps every private fallback route under the same no-store policy", () => {
    const vercel = JSON.parse(source("vercel.json")) as {
      headers?: Array<{
        source?: string;
        headers?: Array<{ key?: string; value?: string }>;
      }>;
    };
    const headers = source("public/_headers");
    const privateVercelSources = [
      "/s",
      "/s/(.*)",
      "/unlock(.*)",
      "/embed/(.*)",
      "/compat/(.*)",
      "/:legacyLocator",
    ];
    const requiredHeaders = [
      ["Cache-Control", "private, no-store"],
      ["CDN-Cache-Control", "no-store"],
      ["Pragma", "no-cache"],
      ["Expires", "0"],
      ["Referrer-Policy", "no-referrer"],
      ["X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet"],
    ];

    for (const route of privateVercelSources) {
      const rule = vercel.headers?.find((entry) => entry.source === route);
      for (const [key, value] of requiredHeaders) {
        expect(rule?.headers).toEqual(
          expect.arrayContaining([expect.objectContaining({ key, value })]),
        );
      }
    }

    for (const route of [
      "/s",
      "/s/*",
      "/unlock*",
      "/embed/*",
      "/compat/*",
      "/:legacyLocator",
    ]) {
      expect(headers).toContain(route);
    }
  });

  it("keeps executable scripts compatible with the no-inline-script CSP", () => {
    const index = source("index.html");
    const offline = source("public/offline.html");
    const inlineExecutableScript =
      /<script(?![^>]*\bsrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/i;

    expect(index).not.toMatch(inlineExecutableScript);
    expect(index).toContain('src="/theme-init.js"');
    expect(offline).not.toMatch(/\son[a-z]+\s*=/i);
    expect(offline).toContain('src="/offline-retry.js"');
  });

  it("allows crawlers only on explicit public routes and immutable assets", () => {
    const robots = source("public/robots.txt");

    expect(robots).toContain("Allow: /$");
    expect(robots).toContain("Allow: /privacy$");
    expect(robots).toContain("Allow: /assets/");
    expect(robots).toContain("Disallow: /");
  });

  it("states the deployed privacy boundary without denying provider analytics", () => {
    const privacy = source("src/pages/Privacy.tsx");
    const privacyText = privacy.replace(/\s+/g, " ");

    expect(privacyText).toContain("Lovable Cloud");
    expect(privacyText).toContain("Cloudflare");
    expect(privacyText).toMatch(/anonymous authentication/i);
    expect(privacyText).toMatch(/client-side encryption/i);
    expect(privacyText).toMatch(/IP geolocation/i);
    expect(privacyText).toMatch(/raw note content/i);
    expect(privacyText).toMatch(/capabilit(?:y|ies)/i);
    expect(privacy).not.toContain(
      "No advertising SDKs, tracking pixels, or third-party analytics.",
    );
    expect(privacyText).toMatch(
      /only after a Cloudflare containment boundary has been deployed and verified/i,
    );
    expect(privacyText).toMatch(/not currently asserted for any host/i);
    expect(privacyText).not.toContain(
      "Cloudflare provides the public security, cache, and response-header boundary",
    );
    expect(privacyText).toMatch(
      /Cloudflare may provide the public security, cache, and response-header boundary only after that containment boundary is deployed and verified/i,
    );
  });

  it("uses authenticated repository dispatch with validated deployment fields", () => {
    const workflow = source(
      ".github/workflows/pwa-update-smoke-post-deploy.yml",
    );

    expect(workflow).toMatch(/repository_dispatch:\s*\n\s*types:/);
    expect(workflow).not.toContain("deployment_status:");
    expect(workflow).toContain("deployed_sha");
    expect(workflow).toContain("build_id");
    expect(workflow).toContain("target_url");
    expect(workflow).toContain("Validate dispatch payload");
    expect(workflow).toContain("ref: ${{ env.DEPLOYED_SHA }}");
    expect(workflow).toContain("POST_DEPLOY_SMOKE: \"1\"");
    expect(workflow).toContain("EXPECTED_BUILD_ID: ${{ env.BUILD_ID }}");
    expect(workflow).toContain(
      "EXPECTED_DEPLOYED_SHA: ${{ env.DEPLOYED_SHA }}",
    );
    expect(workflow).toContain("git rev-parse HEAD");
    expect(workflow).toContain("e2e/pwa-update-production-readonly.spec.ts");
    expect(workflow).not.toContain("e2e/pwa-update-multi-click.spec.ts");
    expect(workflow).not.toContain("e2e/pwa-update-no-url-v-param.spec.ts");
  });

  it("verifies the full CSP and Permissions-Policy after deployment", () => {
    const script = source("scripts/verify-frame-ancestors.sh");

    expect(script).not.toContain("curl -sSIL");
    expect(script).toContain("--max-redirs 0");
    expect(script).toContain("final_status");
    expect(script).toMatch(/final_status.*\^2/);
    expect(script).toContain("permissions-policy");
    expect(script).toContain("default-src");
    expect(script).toContain("frame-ancestors");
    expect(script).toContain("chrome-extension://");
  });

  it("does not treat the no-go template as a deployable generic-share Worker", () => {
    const rollout = source("docs/security/immediate-containment-rollout.md");

    expect(rollout).toMatch(
      /Deploy the generic share Worker from a separately reviewed, staging-proven\s+release configuration/i,
    );
    expect(rollout).toMatch(/wrangler\.toml[\s\S]*no-go[\s\S]*must not be deployed/i);
  });

  it("keeps the post-deploy smoke read-only and provider-isolated", () => {
    const helper = source("e2e/helpers/production-readonly.ts");
    const spec = source("e2e/pwa-update-production-readonly.spec.ts");

    expect(helper).toContain("GET");
    expect(helper).toContain("HEAD");
    expect(helper).toContain("OPTIONS");
    expect(helper).toContain("supabase.co");
    expect(helper).toContain("/api/");
    expect(helper).toContain("/rest/v1/");
    expect(helper).toContain("/functions/v1/");
    expect(helper).toContain("/~api/analytics/");
    expect(helper).toContain("/~flock.js");
    expect(helper).toContain("routeWebSocket");
    expect(helper).toContain("origin");
    expect(helper).toContain("pathname");
    expect(helper).not.toContain("postData");
    expect(helper).not.toMatch(/blockedRequests\.push\(\s*request\.url/);
    expect(spec).toContain('serviceWorkers: "block"');
    expect(spec).toMatch(
      /test\.skip\([\s\S]*process\.env\.POST_DEPLOY_SMOKE !== "1"/,
    );
    expect(spec).toContain('"/version.json"');
    expect(spec).toContain("EXPECTED_BUILD_ID");
    expect(spec).toContain("pwa-update-mock");
    expect(spec).toContain("/privacy?v=legacy-noise&foo=bar");
    expect(spec).toContain("assertNoWrites");
    expect(spec).toContain("serviceWorkers: \"block\"");
  });
});
