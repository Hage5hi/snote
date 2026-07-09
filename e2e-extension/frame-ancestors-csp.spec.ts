import { test, expect } from "./fixtures/extension";

// Contract check for the app the side panel embeds:
// note.syrin.online MUST send a Content-Security-Policy header with
// `frame-ancestors 'self' chrome-extension://*` or Chrome refuses to
// render the app inside the side panel (users see "Couldn't load
// Syrin Note"). This spec fails loudly with a diagnostic message so a
// deploy that silently drops the header can't ship.

const APP_ORIGIN = "https://note.syrin.online";

test("app sends frame-ancestors CSP that allows chrome-extension://*", async ({
  context,
}) => {
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
