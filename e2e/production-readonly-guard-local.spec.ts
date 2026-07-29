import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type BrowserContext } from "@playwright/test";
import {
  startChromiumWorkerAttestation,
  type ChromiumWorkerAttestation,
  type TrustedChromiumWorkerArtifact,
} from "./helpers/chromium-worker-attestation";
import {
  createTrustedWorkerArtifactDigest,
  installProductionReadonlyGuard,
  type ProductionReadonlyPolicy,
} from "./helpers/production-readonly";

const PRIVACY_HTML = `<!doctype html>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<title>Guard rehearsal</title>
<script>
  navigator.serviceWorker.register("/sw.js", { scope: "/" });
</script>`;

const WORKBOX_PATHNAME = "/workbox-9c191d2f.js";
const WORKER_IDENTITY_PATHNAME =
  "/sw-identity-0123456789abcdef.js";
const WORKBOX_SOURCE = "self.__SNOTE_WORKBOX_REHEARSAL__ = true;";
const WORKER_IDENTITY_SOURCE =
  "self.__SNOTE_RELEASE_REHEARSAL__ = true;";
const ROUTED_ATTESTATION_ORIGIN = "https://127.0.0.1:4179";
const WORKER_SOURCE = `
importScripts("${WORKBOX_PATHNAME}");
importScripts("${WORKER_IDENTITY_PATHNAME}");
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      await fetch("/api/blocked", { method: "POST", body: "blocked" });
    } catch {}
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});`;

async function startLoopbackServer(): Promise<{
  origin: string;
  blockedPosts(): number;
  close(): Promise<void>;
}> {
  let blockedPostCount = 0;
  const server: Server = createServer((request, response) => {
    const pathname = new URL(
      request.url ?? "/",
      "http://127.0.0.1",
    ).pathname;
    if (request.method === "POST" && pathname === "/api/blocked") {
      blockedPostCount += 1;
      request.resume();
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && pathname === "/privacy") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      }).end(PRIVACY_HTML);
      return;
    }
    if (request.method === "GET" && pathname === "/sw.js") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/javascript; charset=utf-8",
        "service-worker-allowed": "/",
      }).end(WORKER_SOURCE);
      return;
    }
    if (
      request.method === "GET" &&
      pathname === WORKBOX_PATHNAME
    ) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/javascript; charset=utf-8",
      }).end(WORKBOX_SOURCE);
      return;
    }
    if (
      request.method === "GET" &&
      pathname === WORKER_IDENTITY_PATHNAME
    ) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/javascript; charset=utf-8",
      }).end(WORKER_IDENTITY_SOURCE);
      return;
    }
    response.writeHead(404, { "cache-control": "no-store" }).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo | null;
  if (!address || address.address !== "127.0.0.1") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("loopback guard server failed to bind safely");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    blockedPosts: () => blockedPostCount,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("blocks a service-worker POST before it reaches the loopback server", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "requires Chromium service-worker request interception",
  );
  const server = await startLoopbackServer();
  let context: BrowserContext | undefined;
  let guard:
    | Awaited<ReturnType<typeof installProductionReadonlyGuard>>
    | undefined;
  let offline = false;
  let disposed = false;

  try {
    context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    const policy: ProductionReadonlyPolicy = {
      allowedOrigin: server.origin,
      rollupAssetPathnames: new Set(),
      workerIdentityPath: WORKER_IDENTITY_PATHNAME,
      workboxPathname: WORKBOX_PATHNAME,
      precacheRevisionRequestTargets: new Set(),
    };
    guard = await installProductionReadonlyGuard(page, policy);

    await page.goto(`${server.origin}/privacy`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active?.state === "activated";
    });

    expect(server.blockedPosts()).toBe(0);
    expect(guard.attempts()).toContainEqual({
      method: "OTHER",
      origin: "third-party",
      pathname: "/:blocked-api",
    });

    await context.setOffline(true);
    offline = true;
    await guard.dispose();
    disposed = true;
    await expect(guard.assertNoWrites()).rejects.toThrow();
  } finally {
    const cleanupErrors: unknown[] = [];
    const clean = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (context && !offline) {
      await clean(() => context!.setOffline(true));
    }
    if (guard && !disposed) {
      await clean(() => guard!.dispose());
    }
    if (context) await clean(() => context!.close());
    await clean(() => server.close());
    if (cleanupErrors.length > 0) throw cleanupErrors[0];
  }
});

test("attests exact loaded worker sources through real Chromium CDP", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "requires Chromium service-worker CDP attestation",
  );
  let context: BrowserContext | undefined;
  let attestation: ChromiumWorkerAttestation | undefined;

  try {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      serviceWorkers: "allow",
    });
    const routedSources = new Map<string, string>([
      ["/sw.js", WORKER_SOURCE],
      [WORKBOX_PATHNAME, WORKBOX_SOURCE],
      [WORKER_IDENTITY_PATHNAME, WORKER_IDENTITY_SOURCE],
    ]);
    await context.route(`${ROUTED_ATTESTATION_ORIGIN}/**`, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== "GET") {
        await route.fulfill({ status: 405, body: "" });
        return;
      }
      const source = routedSources.get(pathname);
      if (source !== undefined) {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          headers: {
            "cache-control": "no-store",
            ...(pathname === "/sw.js"
              ? { "service-worker-allowed": "/" }
              : {}),
          },
          body: source,
        });
        return;
      }
      if (pathname === "/privacy") {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: { "cache-control": "no-store" },
          body: PRIVACY_HTML,
        });
        return;
      }
      await route.fulfill({ status: 404, body: "" });
    });
    const page = await context.newPage();
    const artifact = (
      pathname: string,
      source: string,
    ): TrustedChromiumWorkerArtifact => ({
      ...createTrustedWorkerArtifactDigest(pathname, source),
      absoluteUrl: new URL(
        pathname,
        ROUTED_ATTESTATION_ORIGIN,
      ).toString(),
      source,
    });
    const artifacts = [
      artifact("/sw.js", WORKER_SOURCE),
      artifact(WORKBOX_PATHNAME, WORKBOX_SOURCE),
      artifact(WORKER_IDENTITY_PATHNAME, WORKER_IDENTITY_SOURCE),
    ];
    attestation = await startChromiumWorkerAttestation(
      page,
      `${ROUTED_ATTESTATION_ORIGIN}/`,
      artifacts,
    );

    await page.goto(`${ROUTED_ATTESTATION_ORIGIN}/privacy`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.ready;
      return (
        registration.active?.state === "activated" &&
        navigator.serviceWorker.controller !== null
      );
    });
    await attestation.verifyActivatedController();
  } finally {
    const cleanupErrors: unknown[] = [];
    const clean = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (context) await clean(() => context!.setOffline(true));
    if (attestation) await clean(() => attestation!.dispose());
    if (context) await clean(() => context!.close());
    if (cleanupErrors.length > 0) throw cleanupErrors[0];
  }
});
