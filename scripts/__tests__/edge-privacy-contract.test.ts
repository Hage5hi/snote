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
  it("keeps production and staging Workers isolated and non-observing", () => {
    const production = source("cloudflare-worker/wrangler.toml");
    const staging = source("cloudflare-worker/wrangler.staging.toml");

    expect(production).toContain('name = "syrin-prerender"');
    expect(production).toContain('pattern = "note.syrin.online/*"');
    expect(production).toMatch(/\[observability\]\s+enabled\s*=\s*false/);
    expect(production).toMatch(/workers_dev\s*=\s*false/);

    expect(staging).toContain('name = "syrin-prerender-staging"');
    expect(staging).not.toContain('pattern = "note.syrin.online/*"');
    expect(staging).not.toContain('pattern = "syrin.online/*"');
    expect(staging).toMatch(/\[observability\]\s+enabled\s*=\s*false/);
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
  });

  it("verifies the full CSP and Permissions-Policy after deployment", () => {
    const script = source("scripts/verify-frame-ancestors.sh");

    expect(script).toContain("permissions-policy");
    expect(script).toContain("default-src");
    expect(script).toContain("frame-ancestors");
    expect(script).toContain("chrome-extension://");
  });
});
