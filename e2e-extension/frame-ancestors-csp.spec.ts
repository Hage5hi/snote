import { test, expect } from "./fixtures/extension";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Source contract for the app the side panel embeds. The live equivalent is
// intentionally owned by the post-deploy PWA smoke workflow so a PR is not
// judged against an older production deployment.

const APP_ORIGIN = "https://note.syrin.online";

test("hosting configs allow chrome-extension:// frame ancestors", () => {
  const expected = "frame-ancestors 'self' chrome-extension://*";
  const vercel = readFileSync(resolve(process.cwd(), "vercel.json"), "utf8");
  const fallbackHeaders = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");

  expect(vercel).toContain(expected);
  expect(fallbackHeaders).toContain(expected);
});

test("deployed app sends the extension frame-ancestors CSP", async ({
  context,
}) => {
  test.skip(
    process.env.SNOTE_RUN_DEPLOYED_CSP_CHECK !== "1",
    "Live CSP is verified by pwa-update-smoke-post-deploy.yml",
  );
  const res = await context.request.fetch(`${APP_ORIGIN}/`, {
    headers: { "cache-control": "no-cache" },
  });
  expect(res.ok(), `HEAD ${APP_ORIGIN}/ failed: ${res.status()}`).toBeTruthy();

  const csp = res.headers()["content-security-policy"] || "";
  expect(
    csp,
    `Missing Content-Security-Policy header on ${APP_ORIGIN}/ — the extension iframe will be blocked.`,
  ).not.toBe("");

  expect(
    /frame-ancestors/i.test(csp),
    `CSP is present but missing 'frame-ancestors' directive.\n  CSP: ${csp}`,
  ).toBeTruthy();

  expect(
    /chrome-extension:\/\/\*|chrome-extension:\/\//i.test(csp),
    `CSP frame-ancestors does not allow chrome-extension:// — extension embed will break.\n  CSP: ${csp}`,
  ).toBeTruthy();
});
