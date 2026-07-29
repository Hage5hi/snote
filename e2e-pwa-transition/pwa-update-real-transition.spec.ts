import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const BUILD_A = "pwa-e2e-a";
const BUILD_B = "pwa-e2e-b";
const CONTROL_TOKEN = "snote-pwa-transition-local-control-v1";
const CONTROL_HEADER = "x-snote-pwa-transition-token";
const FINGERPRINT = "snote-pwa-transition-v1";
const HEALTH_PATH = "/__pwa-transition/health";
const STATE_PATH = "/__pwa-transition/state";
const CONTROL_PATH = "/__pwa-transition/control";
const NAVIGATION_COUNT_KEY = "snote:pwa-transition:navigation-count";
const LOOPBACK_ORIGIN = "http://127.0.0.1:4178";
const externalRequestAttempts = new WeakMap<BrowserContext, string[]>();

type ControlAction =
  | "reset-a"
  | "switch-b"
  | "switch-b-hold-version"
  | "reject-held-version";

type TransitionServerState = {
  fingerprint: string;
  activeRoot: "a" | "b";
  behavior: "serve" | "hold-version" | "reject-version";
  heldResponses: number;
  bVersionInstallTarget: "/version.json";
};

type WorkerIdentity = {
  type: string;
  payload: {
    protocol: string;
    buildId: string;
    deployedSha: null;
  };
};

async function readJsonResponse<T>(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
): Promise<T> {
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  return (await response.json()) as T;
}

async function readServerState(
  request: APIRequestContext,
): Promise<TransitionServerState> {
  const response = await request.get(STATE_PATH, {
    headers: {
      [CONTROL_HEADER]: CONTROL_TOKEN,
    },
  });
  const state = await readJsonResponse<TransitionServerState>(response);
  expect(state.fingerprint).toBe(FINGERPRINT);
  return state;
}

async function controlServer(
  request: APIRequestContext,
  action: ControlAction,
): Promise<TransitionServerState> {
  const response = await request.post(CONTROL_PATH, {
    headers: {
      [CONTROL_HEADER]: CONTROL_TOKEN,
      "content-type": "application/json",
    },
    data: { action },
  });
  const state = await readJsonResponse<TransitionServerState>(response);
  expect(state.fingerprint).toBe(FINGERPRINT);
  return state;
}

async function requestControllerIdentity(page: Page): Promise<WorkerIdentity> {
  return page.evaluate(async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) throw new Error("missing active controller");

    return await new Promise<WorkerIdentity>((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => {
        channel.port1.close();
        reject(new Error("worker identity request timed out"));
      }, 5_000);
      channel.port1.onmessage = (event: MessageEvent<WorkerIdentity>) => {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage(
        { type: "snote:sw-identity:request:v1" },
        [channel.port2],
      );
    });
  });
}

async function expectControllerBuild(
  page: Page,
  expectedBuildId: typeof BUILD_A | typeof BUILD_B,
): Promise<void> {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return Boolean(
      registration?.active?.state === "activated" &&
        navigator.serviceWorker.controller?.scriptURL ===
          `${window.location.origin}/sw.js`,
    );
  });

  await expect
    .poll(async () => await requestControllerIdentity(page))
    .toEqual({
      type: "snote:sw-identity:response:v1",
      payload: {
        protocol: "snote-sw-identity-v1",
        buildId: expectedBuildId,
        deployedSha: null,
      },
    });
}

async function openControlledBuildA(page: Page): Promise<number> {
  await page.addInitScript((key) => {
    const previous = Number.parseInt(
      window.sessionStorage.getItem(key) ?? "0",
      10,
    );
    const next = Number.isSafeInteger(previous) ? previous + 1 : 1;
    window.sessionStorage.setItem(key, String(next));
    (
      window as unknown as {
        __SNOTE_PWA_TRANSITION_NAVIGATION_COUNT__: number;
      }
    ).__SNOTE_PWA_TRANSITION_NAVIGATION_COUNT__ = next;
  }, NAVIGATION_COUNT_KEY);

  await page.goto("/privacy", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Privacy Policy" }),
  ).toBeVisible();

  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state === "activated";
  });
  const hasController = await page.evaluate(
    () =>
      navigator.serviceWorker.controller?.scriptURL ===
      `${window.location.origin}/sw.js`,
  );
  if (!hasController) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expectControllerBuild(page, BUILD_A);

  return await page.evaluate(
    () =>
      (
        window as unknown as {
          __SNOTE_PWA_TRANSITION_NAVIGATION_COUNT__: number;
        }
      ).__SNOTE_PWA_TRANSITION_NAVIGATION_COUNT__,
  );
}

async function requestServiceWorkerUpdate(page: Page): Promise<void> {
  await page.evaluate(() => {
    void navigator.serviceWorker.ready
      .then((registration) => registration.update())
      .catch(() => undefined);
  });
}

async function installWorkerLifecycleRecorder(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const state = window as unknown as {
      __SNOTE_PWA_TRANSITION_INSTALL_STATES__: string[];
    };
    state.__SNOTE_PWA_TRANSITION_INSTALL_STATES__ = [];
    const track = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const record = () => {
        state.__SNOTE_PWA_TRANSITION_INSTALL_STATES__.push(worker.state);
      };
      record();
      worker.addEventListener("statechange", record);
    };
    registration.addEventListener("updatefound", () => {
      track(registration.installing);
    });
    track(registration.installing);
  });
}

async function navigationCount(page: Page): Promise<number | null> {
  try {
    return await page.evaluate(
      () =>
        (
          window as unknown as {
            __SNOTE_PWA_TRANSITION_NAVIGATION_COUNT__: number;
          }
        ).__SNOTE_PWA_TRANSITION_NAVIGATION_COUNT__,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /Execution context was destroyed|Cannot find context with specified id/.test(
        error.message,
      )
    ) {
      return null;
    }
    throw error;
  }
}

test.beforeEach(async ({ context, request }) => {
  expect(context.serviceWorkers()).toHaveLength(0);
  const externalAttempts: string[] = [];
  externalRequestAttempts.set(context, externalAttempts);
  await context.route("**/*", async (route) => {
    let requestOrigin: string | null = null;
    try {
      requestOrigin = new URL(route.request().url()).origin;
    } catch {
      // Invalid network targets must never leave the isolated harness.
    }
    if (requestOrigin !== LOOPBACK_ORIGIN) {
      externalAttempts.push(
        `${route.request().method()}:${route.request().resourceType()}`,
      );
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  const health = await readJsonResponse<{ fingerprint: string }>(
    await request.get(HEALTH_PATH),
  );
  expect(health).toEqual({ fingerprint: FINGERPRINT });
  const state = await controlServer(request, "reset-a");
  expect(state).toMatchObject({
    activeRoot: "a",
    behavior: "serve",
    heldResponses: 0,
  });
});

test.afterEach(async ({ context, request }) => {
  await context.setOffline(false).catch(() => undefined);
  await controlServer(request, "reset-a");
  expect(externalRequestAttempts.get(context) ?? []).toEqual([]);
});

test("real worker updates A to B with exactly one accepted navigation and keeps B offline", async ({
  context,
  page,
  request,
}) => {
  const baselineNavigations = await openControlledBuildA(page);

  const switched = await controlServer(request, "switch-b");
  expect(switched).toMatchObject({
    activeRoot: "b",
    behavior: "serve",
  });
  await requestServiceWorkerUpdate(page);

  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration?.waiting?.state === "installed";
  });
  const updateButton = page.getByRole("button", { name: "Update" });
  await expect(updateButton).toBeVisible();
  await updateButton.click();

  await expect
    .poll(async () => await navigationCount(page))
    .toBe(baselineNavigations + 1);
  await expectControllerBuild(page, BUILD_B);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __SNOTE_PWA_UPDATE_STATE__?: { currentBuildId?: string };
            }
          ).__SNOTE_PWA_UPDATE_STATE__?.currentBuildId ?? null,
      ),
    )
    .toBe(BUILD_B);
  await expect(
    page.getByRole("heading", { name: "Privacy Policy" }),
  ).toBeVisible();
  expect(await navigationCount(page)).toBe(baselineNavigations + 1);

  await context.setOffline(true);
  const offlineResponse = await page.reload({
    waitUntil: "domcontentloaded",
  });
  expect(offlineResponse).not.toBeNull();
  expect(offlineResponse?.fromServiceWorker()).toBe(true);
  await expectControllerBuild(page, BUILD_B);
  await expect(
    page.getByRole("heading", { name: "Privacy Policy" }),
  ).toBeVisible();
  expect(await navigationCount(page)).toBe(baselineNavigations + 2);
});

test("a rejected B install becomes redundant while active A remains usable offline", async ({
  context,
  page,
  request,
}) => {
  await openControlledBuildA(page);

  const switched = await controlServer(
    request,
    "switch-b-hold-version",
  );
  expect(switched).toMatchObject({
    activeRoot: "b",
    behavior: "hold-version",
    heldResponses: 0,
  });
  await requestServiceWorkerUpdate(page);

  await expect
    .poll(async () => (await readServerState(request)).heldResponses)
    .toBeGreaterThan(0);

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const registration =
          await navigator.serviceWorker.getRegistration("/");
        return {
          activeState: registration?.active?.state ?? null,
          installingState: registration?.installing?.state ?? null,
          waitingState: registration?.waiting?.state ?? null,
        };
      }),
    )
    .toEqual({
      activeState: "activated",
      installingState: "installing",
      waitingState: null,
    });
  await expectControllerBuild(page, BUILD_A);

  const pendingInstallNavigation = await page.reload({
    waitUntil: "domcontentloaded",
  });
  expect(pendingInstallNavigation).not.toBeNull();
  expect(pendingInstallNavigation?.fromServiceWorker()).toBe(true);
  await expectControllerBuild(page, BUILD_A);
  await expect(
    page.getByRole("heading", { name: "Privacy Policy" }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const state = await readServerState(request);
      return {
        activeRoot: state.activeRoot,
        behavior: state.behavior,
        heldResponses: state.heldResponses,
      };
    })
    .toEqual({
      activeRoot: "b",
      behavior: "hold-version",
      heldResponses: 1,
    });
  // The reload replaces the page that owned the original lifecycle listener.
  // Re-attach to the still-installing B worker before releasing the held fetch.
  await installWorkerLifecycleRecorder(page);

  const rejected = await controlServer(request, "reject-held-version");
  expect(rejected.behavior).toBe("reject-version");

  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as unknown as {
            __SNOTE_PWA_TRANSITION_INSTALL_STATES__?: string[];
          }
        ).__SNOTE_PWA_TRANSITION_INSTALL_STATES__?.includes("redundant"),
      ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const registration =
          await navigator.serviceWorker.getRegistration("/");
        return {
          activeState: registration?.active?.state ?? null,
          waitingState: registration?.waiting?.state ?? null,
          controllerUrl:
            navigator.serviceWorker.controller?.scriptURL ?? null,
        };
      }),
    )
    .toEqual({
      activeState: "activated",
      waitingState: null,
      controllerUrl: "http://127.0.0.1:4178/sw.js",
    });
  await expectControllerBuild(page, BUILD_A);

  await context.setOffline(true);
  const offlineResponse = await page.reload({
    waitUntil: "domcontentloaded",
  });
  expect(offlineResponse).not.toBeNull();
  expect(offlineResponse?.fromServiceWorker()).toBe(true);
  await expectControllerBuild(page, BUILD_A);
  await expect(
    page.getByRole("heading", { name: "Privacy Policy" }),
  ).toBeVisible();
});
