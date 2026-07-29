import { expect, type BrowserContext } from "@playwright/test";

export type ProductionReadonlyAttempt = {
  method: string;
  origin: "canonical" | "local-test" | "third-party";
  pathname: string;
};

const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CANONICAL_PRODUCTION_ORIGIN = "https://note.syrin.online";
const LOCAL_REHEARSAL_ORIGIN = "http://localhost:8080";
const CANONICAL_PRODUCTION_POLICY = {
  allowedOrigin: CANONICAL_PRODUCTION_ORIGIN,
};
const ALLOWED_EXACT_PATHNAMES = new Set([
  "/privacy",
  "/version.json",
  "/index.html",
  "/offline.html",
  "/offline-retry.js",
  "/sw-kill.js",
  "/placeholder.svg",
  "/syrin-note-sidepanel.zip.manifest.json",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable.png",
  "/logo.webp",
  "/theme-init.js",
  "/sw.js",
]);
const STATIC_ASSET_PATH_PREFIX = "/assets/";
const ALLOWED_VITE_ASSET_PATHNAME =
  /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{8}\.(?:css|js|woff2?)$/;
const ALLOWED_WORKBOX_PATHNAME = /^\/workbox-[a-f0-9]{8}\.js$/;
const LOCAL_ALLOWED_PATH_PREFIXES = [
  "/@vite/",
  "/src/",
  "/node_modules/.vite/",
];
const LOCAL_ALLOWED_EXACT_PATHNAMES = new Set(["/@react-refresh"]);
const BLOCKED_PATH_PREFIXES = [
  "/api/",
  "/rest/v1/",
  "/functions/v1/",
  "/~api/analytics/",
];
const BLOCKED_EXACT_PATHS = new Set(["/~flock.js"]);
const MAX_PATH_DECODE_PASSES = 3;

export type ProductionReadonlyPolicy = Readonly<{
  allowedOrigin: string;
}>;

export function createProductionReadonlyPolicy(
  baseUrl: string,
  options: { allowLocalhost?: boolean } = {},
): ProductionReadonlyPolicy {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    throw new Error("Production read-only guard requires an absolute base URL");
  }

  if (origin === CANONICAL_PRODUCTION_ORIGIN) {
    return { allowedOrigin: origin };
  }
  if (options.allowLocalhost && origin === LOCAL_REHEARSAL_ORIGIN) {
    return { allowedOrigin: origin };
  }

  throw new Error(
    "Production read-only guard requires the canonical origin; localhost requires explicit opt-in",
  );
}

function classifyEvidenceOrigin(
  origin: string,
): ProductionReadonlyAttempt["origin"] {
  if (origin === CANONICAL_PRODUCTION_ORIGIN) return "canonical";
  if (origin === LOCAL_REHEARSAL_ORIGIN) return "local-test";
  return "third-party";
}

function hasPathPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

function isAllowedSmokePath(origin: string, pathname: string): boolean {
  if (
    ALLOWED_EXACT_PATHNAMES.has(pathname) ||
    ALLOWED_WORKBOX_PATHNAME.test(pathname) ||
    ALLOWED_VITE_ASSET_PATHNAME.test(pathname)
  ) {
    return true;
  }

  return (
    origin === "http://localhost:8080" &&
    (LOCAL_ALLOWED_EXACT_PATHNAMES.has(pathname) ||
      hasPathPrefix(pathname, LOCAL_ALLOWED_PATH_PREFIXES))
  );
}

function redactEvidencePathname(pathname: string | null): string {
  if (pathname === null) return "/:malformed-path";
  if (pathname === "/s" || pathname.startsWith("/s/")) {
    return "/s/:capability";
  }
  if (isBlockedPath(pathname)) return "/:blocked-api";
  if (BLOCKED_EXACT_PATHS.has(pathname)) return "/:blocked-telemetry";
  if (ALLOWED_EXACT_PATHNAMES.has(pathname)) return pathname;
  if (pathname.startsWith(STATIC_ASSET_PATH_PREFIX)) {
    return "/assets/:asset";
  }
  if (
    LOCAL_ALLOWED_EXACT_PATHNAMES.has(pathname) ||
    hasPathPrefix(pathname, LOCAL_ALLOWED_PATH_PREFIXES)
  ) {
    return "/:local-dev-resource";
  }
  if (/^\/[^/]+$/.test(pathname)) return "/:legacy-locator";
  return "/:redacted-path";
}

export function sanitizeProductionReadonlyAttempt(
  url: string,
  method: string,
): ProductionReadonlyAttempt {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      method,
      origin: "third-party",
      pathname: "/:malformed-path",
    };
  }

  return {
    method,
    origin: classifyEvidenceOrigin(parsed.origin),
    pathname: redactEvidencePathname(
      hasAmbiguousRawPath(url)
        ? null
        : normalizePathname(parsed.pathname || "/"),
    ),
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

function resolvePathSegments(pathname: string): string {
  const segments: string[] = [];

  for (const segment of pathname.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `/${segments.join("/")}`;
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
        return resolvePathSegments(decoded);
      }
      normalized = decoded;
    } catch {
      return null;
    }
  }

  return normalized.includes("%") ? null : resolvePathSegments(normalized);
}

function hasAmbiguousRawPath(url: string): boolean {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd <= 0) return true;

  const pathStart = url.indexOf("/", schemeEnd + 3);
  if (pathStart < 0) return false;

  const queryStart = url.indexOf("?", pathStart);
  const fragmentStart = url.indexOf("#", pathStart);
  const pathEnd = [queryStart, fragmentStart]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), url.length);
  const rawPath = url.slice(pathStart, pathEnd);

  return (
    rawPath.includes("%") ||
    rawPath.includes("\\") ||
    rawPath.includes("//") ||
    rawPath.split("/").some((segment) => segment === "." || segment === "..")
  );
}

export function shouldBlockProductionRequest(
  url: string,
  method: string,
  policy: ProductionReadonlyPolicy = CANONICAL_PRODUCTION_POLICY,
): boolean {
  if (hasAmbiguousRawPath(url)) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  const pathname = normalizePathname(parsed.pathname || "/");

  return (
    !ALLOWED_METHODS.has(method.toUpperCase()) ||
    parsed.origin !== policy.allowedOrigin ||
    isSupabaseHost(parsed.hostname.toLowerCase()) ||
    pathname === null ||
    !isAllowedSmokePath(parsed.origin, pathname) ||
    isBlockedPath(pathname) ||
    BLOCKED_EXACT_PATHS.has(pathname)
  );
}

export async function installProductionReadonlyGuard(
  context: BrowserContext,
  policy: ProductionReadonlyPolicy = CANONICAL_PRODUCTION_POLICY,
) {
  const blockedRequests: ProductionReadonlyAttempt[] = [];
  const blockedWebSockets: ProductionReadonlyAttempt[] = [];

  await context.route("**/*", async (route) => {
    const request = route.request();
    const attempt = sanitizeProductionReadonlyAttempt(
      request.url(),
      request.method(),
    );
    const blocked = shouldBlockProductionRequest(
      request.url(),
      request.method(),
      policy,
    );

    if (blocked) {
      blockedRequests.push(attempt);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  await context.routeWebSocket("**/*", async (webSocket) => {
    blockedWebSockets.push(
      sanitizeProductionReadonlyAttempt(webSocket.url(), "WEBSOCKET"),
    );
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
