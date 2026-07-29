import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const PWA_TRANSITION_FINGERPRINT = "snote-pwa-transition-v1";
export const PWA_TRANSITION_CONTROL_HEADER =
  "x-snote-pwa-transition-token";
export const PWA_TRANSITION_HEALTH_PATH = "/__pwa-transition/health";
export const PWA_TRANSITION_STATE_PATH = "/__pwa-transition/state";
export const PWA_TRANSITION_CONTROL_PATH = "/__pwa-transition/control";

const DEFAULT_PORT = 4178;
const LOOPBACK_HOST = "127.0.0.1";
const MAX_CONTROL_BODY_BYTES = 1_024;
const MAX_REQUEST_TARGET_BYTES = 8_192;
const MAX_SERVICE_WORKER_BYTES = 2 * 1_024 * 1_024;
const WORKBOX_VERSION_INSTALL_TARGET = "/version.json";

const CONTROL_ACTIONS = new Set([
  "reset-a",
  "switch-b",
  "switch-b-hold-version",
  "reject-held-version",
] as const);

type ActiveRoot = "a" | "b";
type TransitionBehavior = "serve" | "hold-version" | "reject-version";
type ControlAction =
  | "reset-a"
  | "switch-b"
  | "switch-b-hold-version"
  | "reject-held-version";

type HeldResponse = {
  body: Buffer;
  method: string;
  response: ServerResponse;
};

type TransitionState = {
  activeRoot: ActiveRoot;
  behavior: TransitionBehavior;
};

export type PwaTransitionServerOptions = {
  controlToken: string;
  host?: string;
  port?: number;
  rootA?: string;
  rootB?: string;
};

export type PwaTransitionListeningAddress = {
  host: string;
  origin: string;
  port: number;
};

export type PwaTransitionServer = {
  close(): Promise<void>;
  listen(): Promise<PwaTransitionListeningAddress>;
};

type StaticSnapshot = {
  behavior: TransitionBehavior;
  rootKey: ActiveRoot;
  rootPath: string;
};

type ValidatedTarget = {
  path: string;
  rawTarget: string;
};

function jsonHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  };
}

function sendBuffer(
  response: ServerResponse,
  status: number,
  body: Buffer,
  method: string,
  headers: Record<string, string> = {},
): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    ...headers,
    "content-length": String(body.byteLength),
  });
  response.end(method === "HEAD" ? undefined : body);
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string,
  method: string,
  headers: Record<string, string> = {},
): void {
  sendBuffer(response, status, Buffer.from(body), method, {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  method: string,
): void {
  sendBuffer(
    response,
    status,
    Buffer.from(JSON.stringify(value)),
    method,
    jsonHeaders(),
  );
}

function sendMethodNotAllowed(
  response: ServerResponse,
  method: string,
  allowed: string,
): void {
  sendText(response, 405, "Method not allowed", method, {
    allow: allowed,
    "cache-control": "no-store",
  });
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function validateControlToken(token: string): void {
  const containsControlCharacter =
    typeof token === "string" &&
    [...token].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    });
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 1_024 ||
    containsControlCharacter
  ) {
    throw new Error("PWA transition control token is required and must be valid");
  }
}

function validateFactoryPort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PWA transition port must be an integer from 0 to 65535");
  }
}

function canonicalDirectory(path: string, label: string): string {
  const canonicalPath = realpathSync(resolve(path));
  if (!statSync(canonicalPath).isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return canonicalPath;
}

function validateVersionPrecacheEntry(serviceWorkerSource: string): void {
  const revisions: string[] = [];
  const objectPattern = /\{[^{}]*\}/gu;

  for (const objectMatch of serviceWorkerSource.matchAll(objectPattern)) {
    const objectSource = objectMatch[0];
    const urlMatch =
      /(?:^|[{,\s])["']?url["']?\s*:\s*["'](?:\.?\/)?version\.json["']/u.exec(
        objectSource,
      );
    if (!urlMatch) continue;

    const revisionMatch =
      /(?:^|[{,\s])["']?revision["']?\s*:\s*["']([0-9a-fA-F]{32})["']/u.exec(
        objectSource,
      );
    if (revisionMatch?.[1]) revisions.push(revisionMatch[1]);
  }

  if (revisions.length !== 1) {
    throw new Error(
      "B service worker must contain exactly one version.json revision",
    );
  }
}

function loadBuildBMetadata(rootB: string): {
  versionBody: Buffer;
} {
  const serviceWorkerPath = resolve(rootB, "sw.js");
  const serviceWorkerStats = statSync(serviceWorkerPath);
  if (
    !serviceWorkerStats.isFile() ||
    serviceWorkerStats.size > MAX_SERVICE_WORKER_BYTES
  ) {
    throw new Error("B service worker is missing or too large");
  }

  const serviceWorkerSource = readFileSync(serviceWorkerPath, "utf8");
  validateVersionPrecacheEntry(serviceWorkerSource);
  const versionBody = readFileSync(resolve(rootB, "version.json"));
  return {
    versionBody,
  };
}

function isAuthorized(
  request: IncomingMessage,
  expectedDigest: Buffer,
): boolean {
  const suppliedToken = request.headers[PWA_TRANSITION_CONTROL_HEADER];
  if (typeof suppliedToken !== "string") return false;
  return timingSafeEqual(digestToken(suppliedToken), expectedDigest);
}

function validateRequestTarget(rawTarget: string | undefined):
  | { error: string }
  | ValidatedTarget {
  if (
    rawTarget === undefined ||
    Buffer.byteLength(rawTarget, "utf8") > MAX_REQUEST_TARGET_BYTES ||
    !rawTarget.startsWith("/") ||
    rawTarget.startsWith("//") ||
    rawTarget.includes("#")
  ) {
    return { error: "Invalid request target" };
  }

  const queryIndex = rawTarget.indexOf("?");
  const rawPath =
    queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex);
  if (
    rawPath.includes("\\") ||
    rawPath.includes("%") ||
    rawPath.includes("//") ||
    rawPath
      .split("/")
      .some((segment, index) => index > 0 && (segment === "." || segment === ".."))
  ) {
    return { error: "Unsafe request path" };
  }

  return { path: rawPath, rawTarget };
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rootRelativePath = relative(root, candidate);
  return (
    rootRelativePath === "" ||
    (!isAbsolute(rootRelativePath) &&
      rootRelativePath !== ".." &&
      !rootRelativePath.startsWith(`..${sep}`))
  );
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function staticHeaders(path: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": contentTypeFor(path),
    "x-content-type-options": "nosniff",
  };
  if (path === "/sw.js" || path === "/version.json") {
    headers["cache-control"] = "no-store";
  }
  if (path === "/sw.js") {
    headers["service-worker-allowed"] = "/";
  }
  return headers;
}

function isHtmlNavigation(request: IncomingMessage): boolean {
  const accept = request.headers.accept ?? "";
  return (
    accept
      .split(",")
      .some((entry) => entry.trim().toLowerCase().startsWith("text/html")) &&
    (request.headers["sec-fetch-mode"] === "navigate" ||
      request.headers["sec-fetch-dest"] === "document")
  );
}

async function resolveStaticFile(
  root: string,
  rawPath: string,
  allowFallback: boolean,
): Promise<{ body: Buffer; publicPath: string } | undefined> {
  const publicPath = rawPath === "/" ? "/index.html" : rawPath;
  const lexicalCandidate = resolve(root, `.${publicPath}`);
  if (!isWithinRoot(root, lexicalCandidate)) return undefined;

  try {
    const canonicalCandidate = await realpath(lexicalCandidate);
    if (!isWithinRoot(root, canonicalCandidate)) return undefined;
    if ((await stat(canonicalCandidate)).isFile()) {
      return {
        body: await readFile(canonicalCandidate),
        publicPath,
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }

  if (!allowFallback) return undefined;
  const indexPath = await realpath(resolve(root, "index.html"));
  if (!isWithinRoot(root, indexPath) || !(await stat(indexPath)).isFile()) {
    return undefined;
  }
  return {
    body: await readFile(indexPath),
    publicPath: "/index.html",
  };
}

async function readBoundedJsonBody(
  request: IncomingMessage,
): Promise<{ status: 400 | 413; value?: never } | { status: 200; value: unknown }> {
  const contentLength = request.headers["content-length"];
  if (
    typeof contentLength === "string" &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > MAX_CONTROL_BODY_BYTES
  ) {
    request.resume();
    return { status: 413 };
  }

  return await new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const finish = (
      result:
        | { status: 400 | 413; value?: never }
        | { status: 200; value: unknown },
    ) => {
      if (settled) return;
      settled = true;
      resolveBody(result);
    };

    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > MAX_CONTROL_BODY_BYTES) {
        request.resume();
        finish({ status: 413 });
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (settled) return;
      try {
        finish({
          status: 200,
          value: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      } catch {
        finish({ status: 400 });
      }
    });
    request.on("aborted", () => finish({ status: 400 }));
    request.on("error", () => finish({ status: 400 }));
  });
}

function parseControlAction(value: unknown): ControlAction | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  ) {
    return undefined;
  }
  const action = (value as { action?: unknown }).action;
  return typeof action === "string" &&
    CONTROL_ACTIONS.has(action as ControlAction)
    ? (action as ControlAction)
    : undefined;
}

export function parsePwaTransitionPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^[1-9]\d{0,4}$/u.test(value)) {
    throw new Error("Invalid SNOTE_PWA_TRANSITION_PORT");
  }
  const parsed = Number(value);
  if (parsed > 65_535) {
    throw new Error("Invalid SNOTE_PWA_TRANSITION_PORT");
  }
  return parsed;
}

export function createPwaTransitionServer(
  options: PwaTransitionServerOptions,
): PwaTransitionServer {
  validateControlToken(options.controlToken);
  const host = options.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    throw new Error(`PWA transition server must bind ${LOOPBACK_HOST}`);
  }
  const port = options.port ?? DEFAULT_PORT;
  validateFactoryPort(port);

  const rootA = canonicalDirectory(
    options.rootA ?? resolve(process.cwd(), ".tmp", "pwa-transition", "a"),
    "PWA transition root A",
  );
  const rootB = canonicalDirectory(
    options.rootB ?? resolve(process.cwd(), ".tmp", "pwa-transition", "b"),
    "PWA transition root B",
  );
  const buildB = loadBuildBMetadata(rootB);
  const expectedTokenDigest = digestToken(options.controlToken);
  const heldResponses = new Set<HeldResponse>();
  const transition: TransitionState = {
    activeRoot: "a",
    behavior: "serve",
  };

  let httpServer: Server | undefined;
  let listeningAddress: PwaTransitionListeningAddress | undefined;
  let listenPromise: Promise<PwaTransitionListeningAddress> | undefined;
  let closePromise: Promise<void> | undefined;
  let closing = false;

  const publicState = () => ({
    fingerprint: PWA_TRANSITION_FINGERPRINT,
    activeRoot: transition.activeRoot,
    behavior: transition.behavior,
    heldResponses: heldResponses.size,
    bVersionInstallTarget: WORKBOX_VERSION_INSTALL_TARGET,
  });

  const completeHeldResponses = (status: 200 | 503): void => {
    const pending = [...heldResponses];
    heldResponses.clear();
    for (const held of pending) {
      if (status === 200) {
        sendBuffer(
          held.response,
          200,
          held.body,
          held.method,
          staticHeaders("/version.json"),
        );
      } else {
        sendText(
          held.response,
          503,
          "Version request rejected",
          held.method,
          { "cache-control": "no-store", "retry-after": "0" },
        );
      }
    }
  };

  const applyControlAction = (action: ControlAction): void => {
    switch (action) {
      case "reset-a":
        transition.activeRoot = "a";
        transition.behavior = "serve";
        completeHeldResponses(200);
        return;
      case "switch-b":
        transition.activeRoot = "b";
        transition.behavior = "serve";
        completeHeldResponses(200);
        return;
      case "switch-b-hold-version":
        transition.activeRoot = "b";
        transition.behavior = "hold-version";
        return;
      case "reject-held-version":
        transition.activeRoot = "b";
        transition.behavior = "reject-version";
        completeHeldResponses(503);
    }
  };

  const holdVersionResponse = (
    request: IncomingMessage,
    response: ServerResponse,
  ): void => {
    const held: HeldResponse = {
      body: buildB.versionBody,
      method: request.method ?? "GET",
      response,
    };
    heldResponses.add(held);
    response.once("close", () => heldResponses.delete(held));
  };

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const method = request.method ?? "GET";
    const validatedTarget = validateRequestTarget(request.url);
    if ("error" in validatedTarget) {
      sendText(response, 400, "Bad request", method, {
        "cache-control": "no-store",
      });
      return;
    }
    const { path, rawTarget } = validatedTarget;

    if (path === PWA_TRANSITION_HEALTH_PATH) {
      if (method !== "GET" && method !== "HEAD") {
        sendMethodNotAllowed(response, method, "GET, HEAD");
        return;
      }
      sendJson(
        response,
        200,
        { fingerprint: PWA_TRANSITION_FINGERPRINT },
        method,
      );
      return;
    }

    if (path === PWA_TRANSITION_STATE_PATH) {
      if (method !== "GET" && method !== "HEAD") {
        sendMethodNotAllowed(response, method, "GET, HEAD");
        return;
      }
      if (!isAuthorized(request, expectedTokenDigest)) {
        sendText(response, 401, "Unauthorized", method, {
          "cache-control": "no-store",
        });
        return;
      }
      sendJson(response, 200, publicState(), method);
      return;
    }

    if (path === PWA_TRANSITION_CONTROL_PATH) {
      if (method !== "POST") {
        sendMethodNotAllowed(response, method, "POST");
        return;
      }
      if (!isAuthorized(request, expectedTokenDigest)) {
        request.resume();
        sendText(response, 401, "Unauthorized", method, {
          "cache-control": "no-store",
        });
        return;
      }
      const contentType = request.headers["content-type"] ?? "";
      if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
        request.resume();
        sendText(response, 400, "Invalid control request", method, {
          "cache-control": "no-store",
        });
        return;
      }
      const parsedBody = await readBoundedJsonBody(request);
      if (parsedBody.status !== 200) {
        sendText(
          response,
          parsedBody.status,
          parsedBody.status === 413 ? "Request body too large" : "Invalid JSON",
          method,
          { "cache-control": "no-store" },
        );
        return;
      }
      const action = parseControlAction(parsedBody.value);
      if (!action) {
        sendText(response, 400, "Invalid control action", method, {
          "cache-control": "no-store",
        });
        return;
      }
      applyControlAction(action);
      sendJson(response, 200, publicState(), method);
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendMethodNotAllowed(response, method, "GET, HEAD");
      return;
    }
    if (closing) {
      sendText(response, 503, "Server is closing", method, {
        "cache-control": "no-store",
      });
      return;
    }

    const snapshot: StaticSnapshot = {
      rootKey: transition.activeRoot,
      behavior: transition.behavior,
      rootPath: transition.activeRoot === "a" ? rootA : rootB,
    };
    if (
      snapshot.rootKey === "b" &&
      method === "GET" &&
      rawTarget === WORKBOX_VERSION_INSTALL_TARGET
    ) {
      if (snapshot.behavior === "hold-version") {
        holdVersionResponse(request, response);
        return;
      }
      if (snapshot.behavior === "reject-version") {
        sendText(response, 503, "Version request rejected", method, {
          "cache-control": "no-store",
          "retry-after": "0",
        });
        return;
      }
    }

    try {
      const resolvedFile = await resolveStaticFile(
        snapshot.rootPath,
        path,
        isHtmlNavigation(request),
      );
      if (!resolvedFile) {
        sendText(response, 404, "Not found", method, {
          "cache-control": "no-store",
        });
        return;
      }
      sendBuffer(
        response,
        200,
        resolvedFile.body,
        method,
        staticHeaders(resolvedFile.publicPath),
      );
    } catch {
      sendText(response, 500, "Internal server error", method, {
        "cache-control": "no-store",
      });
    }
  };

  const serverApi: PwaTransitionServer = {
    listen(): Promise<PwaTransitionListeningAddress> {
      if (listeningAddress) return Promise.resolve(listeningAddress);
      if (listenPromise) return listenPromise;
      if (closing) {
        return Promise.reject(new Error("PWA transition server is closed"));
      }

      const server = createServer((request, response) => {
        void handleRequest(request, response).catch(() => {
          sendText(
            response,
            500,
            "Internal server error",
            request.method ?? "GET",
            { "cache-control": "no-store" },
          );
        });
      });
      httpServer = server;
      listenPromise = new Promise((resolveListening, rejectListening) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          httpServer = undefined;
          listenPromise = undefined;
          rejectListening(error);
        };
        const onListening = () => {
          server.off("error", onError);
          const address = server.address();
          if (address === null || typeof address === "string") {
            server.close();
            httpServer = undefined;
            listenPromise = undefined;
            rejectListening(new Error("PWA transition server address unavailable"));
            return;
          }
          listeningAddress = {
            host,
            port: address.port,
            origin: `http://${host}:${address.port}`,
          };
          resolveListening(listeningAddress);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      return listenPromise;
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closing = true;
      transition.behavior = "serve";
      completeHeldResponses(200);

      const server = httpServer;
      if (!server) {
        closePromise = Promise.resolve();
        return closePromise;
      }
      closePromise = new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          httpServer = undefined;
          listeningAddress = undefined;
          if (error) rejectClose(error);
          else resolveClose();
        });
        server.closeIdleConnections();
      });
      return closePromise;
    },
  };

  return serverApi;
}

async function runCli(): Promise<void> {
  const server = createPwaTransitionServer({
    controlToken: process.env.SNOTE_PWA_TRANSITION_CONTROL_TOKEN ?? "",
    port: parsePwaTransitionPort(process.env.SNOTE_PWA_TRANSITION_PORT),
  });
  const listening = await server.listen();
  console.log(
    `PWA transition server ${PWA_TRANSITION_FINGERPRINT} listening at ${listening.origin}`,
  );

  let shutdownStarted = false;
  const shutdown = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    void server.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  resolve(entryPoint) === resolve(fileURLToPath(import.meta.url))
) {
  void runCli().catch(() => {
    console.error("PWA transition server failed to start.");
    process.exitCode = 1;
  });
}
