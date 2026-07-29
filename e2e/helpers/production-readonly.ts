import { createHash } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export type ProductionReadonlyAttempt = {
  method: "GET" | "HEAD" | "OPTIONS" | "OTHER";
  origin: "canonical" | "local-test" | "third-party";
  pathname: string;
};

const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CANONICAL_PRODUCTION_ORIGIN = "https://note.syrin.online";
const LOCAL_REHEARSAL_ORIGIN = "http://localhost:8080";
const CANONICAL_PRODUCTION_POLICY = {
  allowedOrigin: CANONICAL_PRODUCTION_ORIGIN,
  rollupAssetPathnames: new Set<string>(),
  workerIdentityPath: null,
  workboxPathname: null,
  precacheRevisionRequestTargets: new Set<string>(),
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
const ALLOWED_ROLLUP_ASSET_PATHNAME =
  /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{8}\.(?:css|js|mjs|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/;
const ALLOWED_WORKBOX_PATHNAME = /^\/workbox-[a-f0-9]{8}\.js$/;
const ALLOWED_WORKER_IDENTITY_PATHNAME =
  /^\/sw-identity-[a-f0-9]{16}\.js$/;
const ALLOWED_WORKBOX_REVISION_QUERY =
  /^\?__WB_REVISION__=[a-f0-9]{32}$/;
const VERSION_NETWORK_QUERY = "?source=network";
const MAX_ROLLUP_ASSET_PATHNAMES = 512;
const MAX_PRECACHE_ENTRIES = 512;
const MAX_SERVICE_WORKER_SOURCE_BYTES = 2_000_000;
// 512 ASCII asset paths at the validated 256-character maximum consume
// 132,608 JSON bytes including separators. The remaining fixed fields,
// 128-character build ID, SHA and identity path keep the canonical manifest
// below this fail-closed transport ceiling.
export const MAX_REMOTE_VERSION_BODY_BYTES = 160_000;
const BODY_LIMIT_ERROR = "Production response body exceeded safety limit";
const BODY_READ_ERROR = "Production response body was unavailable";
const GUARD_SETUP_ERROR = "Production read-only guard setup failed";
const GUARD_CLEANUP_ERROR = "Production read-only guard cleanup failed";
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
  rollupAssetPathnames: ReadonlySet<string>;
  workerIdentityPath: string | null;
  workboxPathname: string | null;
  precacheRevisionRequestTargets: ReadonlySet<string>;
}>;

export type ProductionReleaseManifest = Readonly<{
  buildId: string;
  deployedSha: string;
  rollupAssetPathnames: readonly string[];
  workerIdentityPath: string;
}>;

type TrustedServiceWorkerArtifacts = Readonly<{
  workboxPathname: string;
  precacheRevisionRequestTargets: readonly string[];
}>;

export type TrustedWorkerArtifactDigest = Readonly<{
  pathname: string;
  byteLength: number;
  sha256: string;
}>;

export function validateRollupAssetPathnames(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ROLLUP_ASSET_PATHNAMES
  ) {
    throw new Error("Invalid static asset manifest");
  }

  const validated: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length > 256 ||
      !ALLOWED_ROLLUP_ASSET_PATHNAME.test(entry) ||
      (validated.length > 0 && validated[validated.length - 1] >= entry)
    ) {
      throw new Error("Invalid static asset manifest");
    }
    validated.push(entry);
  }
  return Object.freeze(validated);
}

export function validateWorkerIdentityPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !ALLOWED_WORKER_IDENTITY_PATHNAME.test(value)
  ) {
    throw new Error("Invalid worker identity path");
  }
  return value;
}

function validateWorkboxPathname(value: unknown): string {
  if (typeof value !== "string" || !ALLOWED_WORKBOX_PATHNAME.test(value)) {
    throw new Error("Invalid Workbox pathname");
  }
  return value;
}

function validatePrecacheRevisionRequestTargets(
  value: unknown,
): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_PRECACHE_ENTRIES) {
    throw new Error("Invalid precache revision request targets");
  }

  const validated: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length > 320 ||
      (validated.length > 0 && validated[validated.length - 1] >= entry)
    ) {
      throw new Error("Invalid precache revision request targets");
    }

    let parsed: URL;
    try {
      parsed = new URL(entry, CANONICAL_PRODUCTION_ORIGIN);
    } catch {
      throw new Error("Invalid precache revision request targets");
    }
    const pathname = normalizePathname(parsed.pathname);
    if (
      !entry.startsWith("/") ||
      parsed.origin !== CANONICAL_PRODUCTION_ORIGIN ||
      parsed.hash !== "" ||
      pathname === null ||
      pathname !== parsed.pathname ||
      `${pathname}${parsed.search}` !== entry ||
      !ALLOWED_WORKBOX_REVISION_QUERY.test(parsed.search)
    ) {
      throw new Error("Invalid precache revision request targets");
    }
    validated.push(entry);
  }
  return Object.freeze(validated);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTrustedWorkerArtifactPathname(pathname: string): boolean {
  return (
    pathname === "/sw.js" ||
    ALLOWED_WORKBOX_PATHNAME.test(pathname) ||
    ALLOWED_WORKER_IDENTITY_PATHNAME.test(pathname)
  );
}

function workerArtifactBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

function isByteView(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    "BYTES_PER_ELEMENT" in value &&
    value.BYTES_PER_ELEMENT === 1
  );
}

function abortSafely(abort: () => void): void {
  try {
    abort();
  } catch {
    // The public failure remains constant-safe.
  }
}

export async function readBoundedResponseBody(
  response: Pick<Response, "body" | "headers">,
  maxBytes: number,
  abort: () => void = () => {},
): Promise<Uint8Array> {
  if (
    !response ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > MAX_SERVICE_WORKER_SOURCE_BYTES
  ) {
    throw new Error(BODY_LIMIT_ERROR);
  }

  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9]\d*)$/.test(declaredLength) ||
      Number(declaredLength) > maxBytes)
  ) {
    abortSafely(abort);
    try {
      await response.body?.cancel();
    } catch {
      // Abort remains best-effort after the fail-closed length check.
    }
    throw new Error(BODY_LIMIT_ERROR);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error(BODY_READ_ERROR);

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!isByteView(chunk.value)) throw new Error(BODY_READ_ERROR);
      byteLength += chunk.value.byteLength;
      if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) {
        abortSafely(abort);
        await reader.cancel();
        throw new Error(BODY_LIMIT_ERROR);
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === BODY_LIMIT_ERROR) {
      throw error;
    }
    abortSafely(abort);
    try {
      await reader.cancel();
    } catch {
      // The public failure remains constant-safe.
    }
    throw new Error(BODY_READ_ERROR);
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function createTrustedWorkerArtifactDigest(
  pathname: string,
  body: string | Uint8Array,
): TrustedWorkerArtifactDigest {
  const bytes = workerArtifactBytes(body);
  if (
    !isTrustedWorkerArtifactPathname(pathname) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_SERVICE_WORKER_SOURCE_BYTES
  ) {
    throw new Error("Invalid trusted worker artifact");
  }
  return Object.freeze({
    pathname,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

export function assertTrustedWorkerArtifactBody(
  body: unknown,
  trusted: TrustedWorkerArtifactDigest,
): void {
  const trustedKeys = isRecord(trusted)
    ? Object.keys(trusted).sort()
    : [];
  if (
    !isByteView(body) ||
    body.byteLength === 0 ||
    body.byteLength > MAX_SERVICE_WORKER_SOURCE_BYTES ||
    !isRecord(trusted) ||
    !equalStringArrays(trustedKeys, ["byteLength", "pathname", "sha256"]) ||
    typeof trusted.pathname !== "string" ||
    !isTrustedWorkerArtifactPathname(trusted.pathname) ||
    typeof trusted.byteLength !== "number" ||
    !Number.isSafeInteger(trusted.byteLength) ||
    trusted.byteLength <= 0 ||
    trusted.byteLength > MAX_SERVICE_WORKER_SOURCE_BYTES ||
    typeof trusted.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(trusted.sha256) ||
    body.byteLength !== trusted.byteLength ||
    createHash("sha256").update(body).digest("hex") !== trusted.sha256
  ) {
    throw new Error(
      "Production worker artifact does not match trusted local build",
    );
  }
}

function equalStringArrays(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function validateProductionReleaseManifest(
  value: unknown,
  expectedBuildId: string,
  expectedDeployedSha: string,
): ProductionReleaseManifest {
  const invalid = () => {
    throw new Error("Invalid production release manifest");
  };
  if (
    !isRecord(value) ||
    typeof expectedBuildId !== "string" ||
    expectedBuildId.length === 0 ||
    !/^[0-9a-f]{40}$/.test(expectedDeployedSha)
  ) {
    return invalid();
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "buildId",
    "deployedSha",
    "rollupAssetPathnames",
    "workerIdentityPath",
  ];
  if (
    !equalStringArrays(keys, expectedKeys) ||
    value.buildId !== expectedBuildId ||
    value.deployedSha !== expectedDeployedSha
  ) {
    return invalid();
  }

  let rollupAssetPathnames: readonly string[];
  let workerIdentityPath: string;
  try {
    rollupAssetPathnames = validateRollupAssetPathnames(
      value.rollupAssetPathnames,
    );
    workerIdentityPath = validateWorkerIdentityPath(value.workerIdentityPath);
  } catch {
    return invalid();
  }
  return Object.freeze({
    buildId: expectedBuildId,
    deployedSha: expectedDeployedSha,
    rollupAssetPathnames,
    workerIdentityPath,
  });
}

export function assertTrustedReleaseManifestMatch(
  remote: ProductionReleaseManifest,
  trusted: ProductionReleaseManifest,
): void {
  if (
    remote.buildId !== trusted.buildId ||
    remote.deployedSha !== trusted.deployedSha ||
    remote.workerIdentityPath !== trusted.workerIdentityPath ||
    !equalStringArrays(
      remote.rollupAssetPathnames,
      trusted.rollupAssetPathnames,
    )
  ) {
    throw new Error(
      "Production release manifest does not match trusted local artifact",
    );
  }
}

export function validateActiveWorkerIdentity(
  value: unknown,
  expectedBuildId: string,
  expectedDeployedSha: string,
): void {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.type !== "snote:sw-identity:response:v1" ||
    !isRecord(value.payload) ||
    Object.keys(value.payload).length !== 3 ||
    value.payload.protocol !== "snote-sw-identity-v1" ||
    value.payload.buildId !== expectedBuildId ||
    value.payload.deployedSha !== expectedDeployedSha
  ) {
    throw new Error("Invalid active service worker identity");
  }
}

export function validateTrustedServiceWorkerArtifacts(
  source: unknown,
  workboxFileNames: unknown,
  workerIdentityPathValue: unknown,
): TrustedServiceWorkerArtifacts {
  const invalid = () => {
    throw new Error("Invalid trusted service worker artifact");
  };
  if (
    typeof source !== "string" ||
    source.length === 0 ||
    source.length > MAX_SERVICE_WORKER_SOURCE_BYTES ||
    !Array.isArray(workboxFileNames) ||
    workboxFileNames.length !== 1
  ) {
    return invalid();
  }

  let workerIdentityPath: string;
  let workboxPathname: string;
  try {
    workerIdentityPath = validateWorkerIdentityPath(workerIdentityPathValue);
    workboxPathname = validateWorkboxPathname(`/${String(workboxFileNames[0])}`);
  } catch {
    return invalid();
  }

  const workboxModule = workboxPathname.slice(1, -3);
  if (
    !source.includes(`["./${workboxModule}"]`) ||
    !source.includes(`importScripts("${workerIdentityPath}")`)
  ) {
    return invalid();
  }

  const marker = ".precacheAndRoute([";
  const manifestStart = source.indexOf(marker);
  if (
    manifestStart < 0 ||
    source.indexOf(marker, manifestStart + marker.length) >= 0
  ) {
    return invalid();
  }
  const entriesStart = manifestStart + marker.length;
  const entriesEnd = source.indexOf("],{}", entriesStart);
  if (entriesEnd < 0) return invalid();
  const entriesSource = source.slice(entriesStart, entriesEnd);
  const entryPattern =
    /\{url:"([A-Za-z0-9][A-Za-z0-9._/-]{0,255})",revision:(null|"([a-f0-9]{32})")\}/g;
  const revisionTargets: string[] = [];
  let entryCount = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(entriesSource)) !== null) {
    const separator = entriesSource.slice(cursor, match.index);
    if (separator !== (entryCount === 0 ? "" : ",")) return invalid();
    const relativePath = match[1];
    if (
      relativePath.includes("..") ||
      relativePath.includes("//") ||
      relativePath.includes("\\")
    ) {
      return invalid();
    }
    entryCount += 1;
    if (entryCount > MAX_PRECACHE_ENTRIES) return invalid();
    if (match[3]) {
      revisionTargets.push(
        `/${relativePath}?__WB_REVISION__=${match[3]}`,
      );
    }
    cursor = entryPattern.lastIndex;
  }
  if (
    entryCount === 0 ||
    cursor !== entriesSource.length ||
    !revisionTargets.some((target) =>
      target.startsWith("/version.json?__WB_REVISION__="),
    ) ||
    !revisionTargets.some((target) =>
      target.startsWith(`${workerIdentityPath}?__WB_REVISION__=`),
    )
  ) {
    return invalid();
  }

  const precacheRevisionRequestTargets = [
    ...new Set(revisionTargets),
  ].sort();
  if (precacheRevisionRequestTargets.length !== revisionTargets.length) {
    return invalid();
  }
  try {
    validatePrecacheRevisionRequestTargets(precacheRevisionRequestTargets);
  } catch {
    return invalid();
  }
  return Object.freeze({
    workboxPathname,
    precacheRevisionRequestTargets: Object.freeze(
      precacheRevisionRequestTargets,
    ),
  });
}

export function createProductionReadonlyPolicy(
  baseUrl: string,
  options: {
    allowLocalhost?: boolean;
    rollupAssetPathnames?: readonly string[];
    workerIdentityPath?: string;
    workboxPathname?: string;
    precacheRevisionRequestTargets?: readonly string[];
  } = {},
): ProductionReadonlyPolicy {
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("Production read-only guard requires an absolute base URL");
  }
  if (
    parsedBaseUrl.username !== "" ||
    parsedBaseUrl.password !== "" ||
    parsedBaseUrl.pathname !== "/" ||
    parsedBaseUrl.search !== "" ||
    parsedBaseUrl.hash !== ""
  ) {
    throw new Error(
      "Production read-only guard requires an exact canonical origin URL",
    );
  }
  const origin = parsedBaseUrl.origin;

  if (
    origin === CANONICAL_PRODUCTION_ORIGIN ||
    (options.allowLocalhost && origin === LOCAL_REHEARSAL_ORIGIN)
  ) {
    const rollupAssetPathnames =
      options.rollupAssetPathnames === undefined
        ? []
        : validateRollupAssetPathnames(options.rollupAssetPathnames);
    const workerIdentityPath =
      options.workerIdentityPath === undefined
        ? null
        : validateWorkerIdentityPath(options.workerIdentityPath);
    const workboxPathname =
      options.workboxPathname === undefined
        ? null
        : validateWorkboxPathname(options.workboxPathname);
    const precacheRevisionRequestTargets =
      options.precacheRevisionRequestTargets === undefined
        ? []
        : validatePrecacheRevisionRequestTargets(
            options.precacheRevisionRequestTargets,
          );
    return {
      allowedOrigin: origin,
      rollupAssetPathnames: new Set(rollupAssetPathnames),
      workerIdentityPath,
      workboxPathname,
      precacheRevisionRequestTargets: new Set(
        precacheRevisionRequestTargets,
      ),
    };
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

function isAllowedSmokePath(
  origin: string,
  pathname: string,
  policy: ProductionReadonlyPolicy,
): boolean {
  if (
    ALLOWED_EXACT_PATHNAMES.has(pathname) ||
    policy.rollupAssetPathnames.has(pathname) ||
    pathname === policy.workerIdentityPath ||
    pathname === policy.workboxPathname
  ) {
    return true;
  }

  return (
    origin === "http://localhost:8080" &&
    (LOCAL_ALLOWED_EXACT_PATHNAMES.has(pathname) ||
      hasPathPrefix(pathname, LOCAL_ALLOWED_PATH_PREFIXES))
  );
}

function isAllowedSmokeQuery(
  origin: string,
  pathname: string,
  search: string,
  policy: ProductionReadonlyPolicy,
): boolean {
  if (origin === LOCAL_REHEARSAL_ORIGIN) return search === "";
  if (pathname === "/privacy") {
    return (
      search === "" ||
      search === "?v=legacy-noise&foo=bar" ||
      search === "?foo=bar"
    );
  }
  if (pathname === "/version.json" && search === VERSION_NETWORK_QUERY) {
    return true;
  }
  return (
    search === "" ||
    policy.precacheRevisionRequestTargets.has(`${pathname}${search}`)
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
  const sanitizedMethod = sanitizeEvidenceMethod(method);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      method: sanitizedMethod,
      origin: "third-party",
      pathname: "/:malformed-path",
    };
  }

  return {
    method: sanitizedMethod,
    origin: classifyEvidenceOrigin(parsed.origin),
    pathname: redactEvidencePathname(
      hasAmbiguousRawPath(url)
        ? null
        : normalizePathname(parsed.pathname || "/"),
    ),
  };
}

function sanitizeEvidenceMethod(
  method: string,
): ProductionReadonlyAttempt["method"] {
  switch (method.toUpperCase()) {
    case "GET":
      return "GET";
    case "HEAD":
      return "HEAD";
    case "OPTIONS":
      return "OPTIONS";
    default:
      return "OTHER";
  }
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
    parsed.hash !== "" ||
    !isAllowedSmokePath(parsed.origin, pathname, policy) ||
    !isAllowedSmokeQuery(parsed.origin, pathname, parsed.search, policy) ||
    isBlockedPath(pathname) ||
    BLOCKED_EXACT_PATHS.has(pathname)
  );
}

export type BoundedReadonlyResponse = Readonly<{
  body: Uint8Array;
  headers: Headers;
}>;

export async function fetchBoundedReadonlyResource(
  url: string,
  policy: ProductionReadonlyPolicy,
  maxBytes: number,
  timeoutMs = 15_000,
): Promise<BoundedReadonlyResponse> {
  if (
    shouldBlockProductionRequest(url, "GET", policy) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > MAX_SERVICE_WORKER_SOURCE_BYTES ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 30_000
  ) {
    throw new Error("Production bounded request failed validation");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      headers: {
        accept: "*/*",
        "accept-encoding": "identity",
        "cache-control": "no-store",
        pragma: "no-cache",
      },
      signal: controller.signal,
    });
    const contentEncoding = response.headers.get("content-encoding");
    if (
      response.status !== 200 ||
      response.url !== url ||
      response.headers.has("location") ||
      (contentEncoding !== null &&
        contentEncoding.toLowerCase() !== "identity")
    ) {
      controller.abort();
      throw new Error("Production bounded response failed validation");
    }
    const body = await readBoundedResponseBody(
      response,
      maxBytes,
      () => controller.abort(),
    );
    return Object.freeze({ body, headers: response.headers });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === BODY_LIMIT_ERROR ||
        error.message === BODY_READ_ERROR ||
        error.message === "Production bounded response failed validation")
    ) {
      throw error;
    }
    throw new Error("Production bounded request was unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function installProductionReadonlyGuard(
  page: Page,
  policy: ProductionReadonlyPolicy = CANONICAL_PRODUCTION_POLICY,
) {
  const blockedRequests: ProductionReadonlyAttempt[] = [];
  const blockedWebSockets: ProductionReadonlyAttempt[] = [];
  const context = page.context();
  let disposed = false;

  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (
        shouldBlockProductionRequest(
          request.url(),
          request.method(),
          policy,
        )
      ) {
        blockedRequests.push(
          sanitizeProductionReadonlyAttempt(
            request.url(),
            request.method(),
          ),
        );
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await context.routeWebSocket("**/*", async (webSocket) => {
      blockedWebSockets.push(
        sanitizeProductionReadonlyAttempt(webSocket.url(), "WEBSOCKET"),
      );
      await webSocket.close({
        code: 1000,
        reason: "production smoke is read-only",
      });
    });
  } catch {
    try {
      await context.unrouteAll({ behavior: "wait" });
    } catch {
      // Setup still fails closed with a constant-safe error.
    }
    throw new Error(GUARD_SETUP_ERROR);
  }

  return Object.freeze({
    attempts(): ProductionReadonlyAttempt[] {
      return [...blockedRequests, ...blockedWebSockets];
    },
    async assertNoWrites(): Promise<void> {
      expect(
        blockedRequests,
        "production smoke attempted a blocked/write request",
      ).toEqual([]);
      expect(
        blockedWebSockets,
        "production smoke attempted a WebSocket connection",
      ).toEqual([]);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        await context.unrouteAll({ behavior: "wait" });
      } catch {
        throw new Error(GUARD_CLEANUP_ERROR);
      }
    },
  });
}
