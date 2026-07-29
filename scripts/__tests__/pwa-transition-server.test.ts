import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPwaTransitionServer,
  parsePwaTransitionPort,
  PWA_TRANSITION_CONTROL_HEADER,
  PWA_TRANSITION_CONTROL_PATH,
  PWA_TRANSITION_FINGERPRINT,
  PWA_TRANSITION_HEALTH_PATH,
  PWA_TRANSITION_STATE_PATH,
  type PwaTransitionServer,
} from "../pwa-transition-server";

const CONTROL_TOKEN = "transition-control-token";
const VERSION_REVISION = "b".repeat(32);

type Fixture = {
  base: string;
  rootA: string;
  rootB: string;
};

type RawResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

type TransitionState = {
  fingerprint: string;
  activeRoot: "a" | "b";
  behavior: "serve" | "hold-version" | "reject-version";
  heldResponses: number;
  bVersionInstallTarget: "/version.json";
};

const servers: PwaTransitionServer[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createFixture(defaultLayout = false): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "snote-pwa-transition-"));
  tempDirectories.push(base);
  const rootA = defaultLayout
    ? join(base, ".tmp", "pwa-transition", "a")
    : join(base, "a");
  const rootB = defaultLayout
    ? join(base, ".tmp", "pwa-transition", "b")
    : join(base, "b");
  await Promise.all([
    mkdir(rootA, { recursive: true }),
    mkdir(rootB, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(rootA, "index.html"), "<h1>build-a</h1>"),
    writeFile(join(rootA, "version.json"), '{"buildId":"build-a"}'),
    writeFile(join(rootA, "sw.js"), 'self.BUILD_ID="build-a";'),
    writeFile(join(rootA, "asset.js"), 'self.asset="a";'),
    writeFile(join(rootB, "index.html"), "<h1>build-b</h1>"),
    writeFile(join(rootB, "version.json"), '{"buildId":"build-b"}'),
    writeFile(
      join(rootB, "sw.js"),
      `define(["./workbox-aaaaaaaa"],function(workbox){"use strict";workbox.precacheAndRoute([{url:"index.html",revision:"${"a".repeat(
        32,
      )}"},{url:"version.json",revision:"${VERSION_REVISION}"}],{});});`,
    ),
    writeFile(join(rootB, "asset.js"), 'self.asset="b";'),
  ]);
  return { base, rootA, rootB };
}

async function startServer(fixture: Fixture): Promise<{
  server: PwaTransitionServer;
  origin: string;
}> {
  const server = createPwaTransitionServer({
    controlToken: CONTROL_TOKEN,
    host: "127.0.0.1",
    port: 0,
    rootA: fixture.rootA,
    rootB: fixture.rootB,
  });
  servers.push(server);
  const listening = await server.listen();
  return { server, origin: listening.origin };
}

function authHeaders(): Record<string, string> {
  return { [PWA_TRANSITION_CONTROL_HEADER]: CONTROL_TOKEN };
}

async function readState(origin: string): Promise<TransitionState> {
  const response = await fetch(`${origin}${PWA_TRANSITION_STATE_PATH}`, {
    headers: authHeaders(),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as TransitionState;
}

async function control(
  origin: string,
  action:
    | "reset-a"
    | "switch-b"
    | "switch-b-hold-version"
    | "reject-held-version",
): Promise<TransitionState> {
  const response = await fetch(`${origin}${PWA_TRANSITION_CONTROL_PATH}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as TransitionState;
}

async function waitForHeldResponses(
  origin: string,
  expected: number,
): Promise<TransitionState> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await readState(origin);
    if (state.heldResponses === expected) return state;
    await new Promise<void>((resolveImmediate) =>
      setImmediate(resolveImmediate),
    );
  }
  throw new Error("held response condition was not reached");
}

async function rawRequest(
  origin: string,
  path: string,
  options: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<RawResponse> {
  const target = new URL(origin);
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: Number(target.port),
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        response.on("end", () =>
          resolveResponse({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", rejectResponse);
    if (options.body !== undefined) request.end(options.body);
    else request.end();
  });
}

describe("PWA transition server", () => {
  it("uses strict CLI port parsing and exact default roots on loopback", async () => {
    expect(parsePwaTransitionPort(undefined)).toBe(4178);
    expect(parsePwaTransitionPort("1")).toBe(1);
    expect(parsePwaTransitionPort("65535")).toBe(65535);
    for (const invalid of ["", "0", "01", " 4178", "4178 ", "65536", "1.5", "x"]) {
      expect(() => parsePwaTransitionPort(invalid)).toThrow(
        "Invalid SNOTE_PWA_TRANSITION_PORT",
      );
    }

    const fixture = await createFixture(true);
    const previousDirectory = process.cwd();
    process.chdir(fixture.base);
    try {
      expect(() =>
        createPwaTransitionServer({
          controlToken: "",
          port: 0,
        }),
      ).toThrow("control token is required");
      const server = createPwaTransitionServer({
        controlToken: CONTROL_TOKEN,
        port: 0,
      });
      servers.push(server);
      const listening = await server.listen();
      expect(listening.host).toBe("127.0.0.1");
      expect(await (await fetch(`${listening.origin}/`)).text()).toContain(
        "build-a",
      );
    } finally {
      process.chdir(previousDirectory);
    }
  });

  it("exposes a fixed unauthenticated health check and authenticated state/control", async () => {
    const fixture = await createFixture();
    const { origin } = await startServer(fixture);

    const health = await fetch(`${origin}${PWA_TRANSITION_HEALTH_PATH}`);
    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(await health.json()).toEqual({
      fingerprint: PWA_TRANSITION_FINGERPRINT,
    });

    for (const headers of [undefined, { [PWA_TRANSITION_CONTROL_HEADER]: "wrong" }]) {
      const state = await fetch(`${origin}${PWA_TRANSITION_STATE_PATH}`, {
        headers,
      });
      expect(state.status).toBe(401);
      expect(await state.text()).not.toContain(CONTROL_TOKEN);
    }
    expect(
      (
        await fetch(`${origin}${PWA_TRANSITION_CONTROL_PATH}`, {
          headers: authHeaders(),
        })
      ).status,
    ).toBe(405);
    expect(
      (
        await fetch(`${origin}${PWA_TRANSITION_STATE_PATH}`, {
          method: "POST",
          headers: authHeaders(),
        })
      ).status,
    ).toBe(405);

    expect(await (await fetch(`${origin}/`)).text()).toContain("build-a");
    const switched = await control(origin, "switch-b");
    expect(switched).toMatchObject({
      fingerprint: PWA_TRANSITION_FINGERPRINT,
      activeRoot: "b",
      behavior: "serve",
      heldResponses: 0,
      bVersionInstallTarget: "/version.json",
    });
    expect(await (await fetch(`${origin}/`)).text()).toContain("build-b");
  });

  it("serves only safe GET/HEAD static paths with navigation-only SPA fallback", async () => {
    const fixture = await createFixture();
    const { origin } = await startServer(fixture);
    await control(origin, "switch-b");

    const serviceWorker = await fetch(`${origin}/sw.js`);
    expect(serviceWorker.status).toBe(200);
    expect(serviceWorker.headers.get("cache-control")).toBe("no-store");
    expect(serviceWorker.headers.get("service-worker-allowed")).toBe("/");

    const version = await fetch(`${origin}/version.json?source=network`);
    expect(version.status).toBe(200);
    expect(version.headers.get("cache-control")).toBe("no-store");
    expect(await version.json()).toEqual({ buildId: "build-b" });

    const head = await rawRequest(origin, "/version.json", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect(Number(head.headers["content-length"])).toBeGreaterThan(0);

    const navigation = await rawRequest(origin, "/privacy", {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "sec-fetch-mode": "navigate",
      },
    });
    expect(navigation.status).toBe(200);
    expect(navigation.body).toContain("build-b");
    expect(
      (
        await rawRequest(origin, "/privacy", {
          headers: { accept: "text/html" },
        })
      ).status,
    ).toBe(404);
    expect((await rawRequest(origin, "/missing.js")).status).toBe(404);
    expect(
      (
        await rawRequest(origin, "/index.html", {
          method: "POST",
        })
      ).status,
    ).toBe(405);

    for (const unsafePath of [
      "/../version.json",
      "/./index.html",
      "/assets//secret.js",
      "/assets%2fsecret.js",
      "/%2e%2e/version.json",
      "/assets\\secret.js",
    ]) {
      expect((await rawRequest(origin, unsafePath)).status).toBe(400);
    }
  });

  it("bounds control JSON and accepts only the four exact actions", async () => {
    const fixture = await createFixture();
    const { origin } = await startServer(fixture);
    const headers = {
      ...authHeaders(),
      "content-type": "application/json",
    };

    for (const body of [
      "{}",
      '{"action":"switch-c"}',
      '{"action":"switch-b","extra":true}',
      "not-json",
    ]) {
      const response = await fetch(`${origin}${PWA_TRANSITION_CONTROL_PATH}`, {
        method: "POST",
        headers,
        body,
      });
      expect(response.status).toBe(400);
    }
    const oversized = await fetch(`${origin}${PWA_TRANSITION_CONTROL_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "switch-b", padding: "x".repeat(2_000) }),
    });
    expect(oversized.status).toBe(413);

    for (const action of [
      "reset-a",
      "switch-b",
      "switch-b-hold-version",
      "reject-held-version",
    ] as const) {
      expect((await control(origin, action)).fingerprint).toBe(
        PWA_TRANSITION_FINGERPRINT,
      );
    }
  });

  it("holds only B's exact Workbox install fetch and can reject or reset it", async () => {
    const fixture = await createFixture();
    const { origin } = await startServer(fixture);
    const installTarget = "/version.json";

    await control(origin, "switch-b-hold-version");
    const liveVersion = await fetch(`${origin}/version.json?source=network`);
    expect(liveVersion.status).toBe(200);
    expect(await liveVersion.json()).toEqual({ buildId: "build-b" });

    const heldForRejection = fetch(`${origin}${installTarget}`);
    await waitForHeldResponses(origin, 1);
    const rejectedState = await control(origin, "reject-held-version");
    expect(rejectedState.behavior).toBe("reject-version");
    expect((await heldForRejection).status).toBe(503);
    expect((await fetch(`${origin}${installTarget}`)).status).toBe(503);
    expect(
      (await fetch(`${origin}/version.json?source=network`)).status,
    ).toBe(200);

    await control(origin, "switch-b-hold-version");
    const heldOne = fetch(`${origin}${installTarget}`);
    const heldTwo = fetch(`${origin}${installTarget}`);
    await waitForHeldResponses(origin, 2);
    const resetState = await control(origin, "reset-a");
    expect(resetState).toMatchObject({
      activeRoot: "a",
      behavior: "serve",
      heldResponses: 0,
    });
    const released = await Promise.all([heldOne, heldTwo]);
    expect(released.map((response) => response.status)).toEqual([200, 200]);
    expect(
      await Promise.all(released.map((response) => response.json())),
    ).toEqual([{ buildId: "build-b" }, { buildId: "build-b" }]);
    expect(
      await (await fetch(`${origin}/version.json?source=network`)).json(),
    ).toEqual({ buildId: "build-a" });
  });

  it("releases every held response before close completes", async () => {
    const fixture = await createFixture();
    const { origin, server } = await startServer(fixture);
    const installTarget = "/version.json";

    await control(origin, "switch-b-hold-version");
    const heldOne = fetch(`${origin}${installTarget}`);
    const heldTwo = fetch(`${origin}${installTarget}`);
    await waitForHeldResponses(origin, 2);

    const closing = server.close();
    const released = await Promise.all([heldOne, heldTwo]);
    expect(released.map((response) => response.status)).toEqual([200, 200]);
    expect(
      await Promise.all(released.map((response) => response.json())),
    ).toEqual([{ buildId: "build-b" }, { buildId: "build-b" }]);
    await closing;
  });
});
