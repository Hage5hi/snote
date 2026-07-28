import { expect, type Page } from "@playwright/test";

export type ProductionReadonlyAttempt = {
  method: string;
  origin: string;
  pathname: string;
};

const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BLOCKED_PATH_PREFIXES = [
  "/api/",
  "/rest/v1/",
  "/functions/v1/",
  "/~api/analytics/",
];
const BLOCKED_EXACT_PATHS = new Set(["/~flock.js"]);
const MAX_PATH_DECODE_PASSES = 3;

function sanitizedAttempt(url: string, method: string): ProductionReadonlyAttempt {
  const parsed = new URL(url);
  return {
    method,
    origin: parsed.origin,
    pathname: parsed.pathname || "/",
  };
}

function isSupabaseHost(hostname: string): boolean {
  return hostname === "supabase.co" || hostname.endsWith(".supabase.co");
}

function isBlockedPath(pathname: string): boolean {
  return BLOCKED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix),
  );
}

function normalizePathname(pathname: string): string | null {
  let normalized = pathname;

  // A browser can preserve percent-encoded separators in request.url(). Decode
  // only a bounded number of times, and fail closed for malformed or still-
  // encoded paths so an API/telemetry request cannot bypass this smoke guard.
  for (let pass = 0; pass < MAX_PATH_DECODE_PASSES; pass += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) {
        return decoded.toLowerCase();
      }
      normalized = decoded;
    } catch {
      return null;
    }
  }

  return normalized.includes("%") ? null : normalized.toLowerCase();
}

export function shouldBlockProductionRequest(
  url: string,
  method: string,
): boolean {
  const parsed = new URL(url);
  const pathname = normalizePathname(parsed.pathname || "/");

  return (
    !ALLOWED_METHODS.has(method.toUpperCase()) ||
    isSupabaseHost(parsed.hostname.toLowerCase()) ||
    pathname === null ||
    isBlockedPath(pathname) ||
    BLOCKED_EXACT_PATHS.has(pathname)
  );
}

export async function installProductionReadonlyGuard(page: Page) {
  const blockedRequests: ProductionReadonlyAttempt[] = [];
  const blockedWebSockets: ProductionReadonlyAttempt[] = [];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const attempt = sanitizedAttempt(request.url(), request.method());
    const blocked = shouldBlockProductionRequest(
      request.url(),
      request.method(),
    );

    if (blocked) {
      blockedRequests.push(attempt);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  await page.routeWebSocket("**/*", async (webSocket) => {
    blockedWebSockets.push(sanitizedAttempt(webSocket.url(), "WEBSOCKET"));
    await webSocket.close({ code: 1000, reason: "production smoke is read-only" });
  });

  return {
    blockedRequests,
    blockedWebSockets,
    attempts(): ProductionReadonlyAttempt[] {
      return [...blockedRequests, ...blockedWebSockets];
    },
    assertNoWrites(): void {
      expect(
        blockedRequests,
        "production smoke attempted a blocked/write request",
      ).toEqual([]);
      expect(
        blockedWebSockets,
        "production smoke attempted a WebSocket connection",
      ).toEqual([]);
    },
  };
}
