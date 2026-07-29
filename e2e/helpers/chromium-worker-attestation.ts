import type {
  BrowserContext,
  CDPSession,
  Page,
  Response,
} from "@playwright/test";
import {
  assertTrustedWorkerArtifactBody,
  type TrustedWorkerArtifactDigest,
} from "./production-readonly";

const BROWSER_RESPONSE_ERROR =
  "Chromium worker browser response attestation failed";
const VERSION_ERROR = "Chromium worker version attestation failed";
const LOADED_SOURCE_ERROR =
  "Chromium worker loaded source attestation failed";
const CDP_COMMAND_ERROR = "Chromium worker CDP command failed";
const CDP_COMMAND_TIMEOUT_ERROR = "Chromium worker CDP command timed out";
const CDP_CLEANUP_ERROR = "Chromium worker CDP cleanup failed";
const SETUP_ERROR = "Chromium worker attestation setup failed";
const CLEANUP_ERROR = "Chromium worker attestation cleanup failed";
const DEFAULT_ATTESTATION_TIMEOUT_MS = 15_000;
const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 5_000;

export type TrustedChromiumWorkerArtifact = Readonly<
  TrustedWorkerArtifactDigest & {
    absoluteUrl: string;
    source: string;
  }
>;

export type ChromiumWorkerVersionSnapshot = Readonly<{
  registrations: readonly Record<string, unknown>[];
  versions: readonly Record<string, unknown>[];
}>;

export type ChromiumWorkerAttestation = Readonly<{
  verifyActivatedController(timeoutMs?: number): Promise<void>;
  dispose(): Promise<void>;
}>;

type InitialBrowserResponse = Readonly<{
  absoluteUrl: string;
  body: Uint8Array;
}>;

type LoadedWorkerSource = Readonly<{
  absoluteUrl: string;
  source: string;
}>;

type RootCdpSession = {
  on(event: string, listener: (payload: unknown) => void): unknown;
  off(event: string, listener: (payload: unknown) => void): unknown;
  send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
};

type NestedCdpEvent = Readonly<{
  method: string;
  params: unknown;
}>;

type PendingNestedCommand = {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

export type NestedCdpTransport = Readonly<{
  send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  onEvent(listener: (event: NestedCdpEvent) => void): () => void;
  dispose(): Promise<void>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digestOnly(
  artifact: TrustedChromiumWorkerArtifact,
): TrustedWorkerArtifactDigest {
  return {
    pathname: artifact.pathname,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
  };
}

function validatedArtifactMap(
  artifacts: readonly TrustedChromiumWorkerArtifact[],
): ReadonlyMap<string, TrustedChromiumWorkerArtifact> {
  if (!Array.isArray(artifacts) || artifacts.length !== 3) {
    throw new Error(SETUP_ERROR);
  }

  const byUrl = new Map<string, TrustedChromiumWorkerArtifact>();
  for (const artifact of artifacts) {
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      typeof artifact.absoluteUrl !== "string" ||
      typeof artifact.pathname !== "string" ||
      typeof artifact.source !== "string"
    ) {
      throw new Error(SETUP_ERROR);
    }

    let parsed: URL;
    try {
      parsed = new URL(artifact.absoluteUrl);
      assertTrustedWorkerArtifactBody(
        new TextEncoder().encode(artifact.source),
        digestOnly(artifact),
      );
    } catch {
      throw new Error(SETUP_ERROR);
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.pathname !== artifact.pathname ||
      byUrl.has(artifact.absoluteUrl)
    ) {
      throw new Error(SETUP_ERROR);
    }
    byUrl.set(artifact.absoluteUrl, artifact);
  }
  return byUrl;
}

function throwSafe(message: string): never {
  throw new Error(message);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function withDefaultCdpTimeout<T>(promise: Promise<T>): Promise<T> {
  return withTimeout(
    promise,
    DEFAULT_CDP_COMMAND_TIMEOUT_MS,
    CDP_COMMAND_TIMEOUT_ERROR,
  );
}

export function assertTrustedInitialBrowserResponses(
  responses: readonly InitialBrowserResponse[],
  artifacts: readonly TrustedChromiumWorkerArtifact[],
): void {
  try {
    const trustedByUrl = validatedArtifactMap(artifacts);
    if (!Array.isArray(responses) || responses.length < trustedByUrl.size) {
      throw new Error();
    }

    const seen = new Set<string>();
    for (const response of responses) {
      if (
        !isRecord(response) ||
        typeof response.absoluteUrl !== "string"
      ) {
        throw new Error();
      }
      const trusted = trustedByUrl.get(response.absoluteUrl);
      if (!trusted) throw new Error();
      assertTrustedWorkerArtifactBody(
        response.body,
        digestOnly(trusted),
      );
      seen.add(response.absoluteUrl);
    }
    if (seen.size !== trustedByUrl.size) throw new Error();
  } catch {
    throwSafe(BROWSER_RESPONSE_ERROR);
  }
}

export function assertTrustedLoadedWorkerSources(
  sources: readonly LoadedWorkerSource[],
  artifacts: readonly TrustedChromiumWorkerArtifact[],
): void {
  try {
    const trustedByUrl = validatedArtifactMap(artifacts);
    if (!Array.isArray(sources) || sources.length !== trustedByUrl.size) {
      throw new Error();
    }

    const seen = new Set<string>();
    for (const loaded of sources) {
      if (
        !isRecord(loaded) ||
        typeof loaded.absoluteUrl !== "string" ||
        typeof loaded.source !== "string" ||
        seen.has(loaded.absoluteUrl)
      ) {
        throw new Error();
      }
      const trusted = trustedByUrl.get(loaded.absoluteUrl);
      if (!trusted) throw new Error();
      assertTrustedWorkerArtifactBody(
        new TextEncoder().encode(loaded.source),
        digestOnly(trusted),
      );
      seen.add(loaded.absoluteUrl);
    }
    if (seen.size !== trustedByUrl.size) throw new Error();
  } catch {
    throwSafe(LOADED_SOURCE_ERROR);
  }
}

export function selectActivatedWorkerTarget(
  snapshot: ChromiumWorkerVersionSnapshot,
  expectedScope: string,
  expectedScriptUrl: string,
  pageTargetId: string,
): { targetId: string; versionId: string } {
  try {
    if (
      !isRecord(snapshot) ||
      !Array.isArray(snapshot.registrations) ||
      !Array.isArray(snapshot.versions) ||
      typeof expectedScope !== "string" ||
      typeof expectedScriptUrl !== "string" ||
      typeof pageTargetId !== "string" ||
      pageTargetId.length === 0
    ) {
      throw new Error();
    }

    const registrations = snapshot.registrations.filter(
      (registration) =>
        isRecord(registration) &&
        registration.scopeURL === expectedScope &&
        registration.isDeleted === false,
    );
    if (registrations.length !== 1) throw new Error();
    const registrationId = registrations[0].registrationId;
    if (typeof registrationId !== "string" || registrationId.length === 0) {
      throw new Error();
    }

    const nonRedundant = snapshot.versions.filter(
      (version) =>
        isRecord(version) &&
        version.registrationId === registrationId &&
        version.status !== "redundant",
    );
    if (nonRedundant.length !== 1) throw new Error();
    const version = nonRedundant[0];
    if (
      version.status !== "activated" ||
      version.runningStatus !== "running" ||
      version.scriptURL !== expectedScriptUrl ||
      typeof version.versionId !== "string" ||
      version.versionId.length === 0 ||
      typeof version.targetId !== "string" ||
      version.targetId.length === 0 ||
      !Array.isArray(version.controlledClients) ||
      !version.controlledClients.includes(pageTargetId)
    ) {
      throw new Error();
    }
    return {
      targetId: version.targetId,
      versionId: version.versionId,
    };
  } catch {
    throwSafe(VERSION_ERROR);
  }
}

export function createNestedCdpTransport(
  root: RootCdpSession,
  sessionId: string,
  commandTimeoutMs = DEFAULT_CDP_COMMAND_TIMEOUT_MS,
): NestedCdpTransport {
  if (
    !root ||
    typeof root.on !== "function" ||
    typeof root.off !== "function" ||
    typeof root.send !== "function" ||
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    !Number.isSafeInteger(commandTimeoutMs) ||
    commandTimeoutMs <= 0 ||
    commandTimeoutMs > 30_000
  ) {
    throw new Error(CDP_COMMAND_ERROR);
  }

  let disposed = false;
  let nextCommandId = 1;
  const pending = new Map<number, PendingNestedCommand>();
  const eventListeners = new Set<(event: NestedCdpEvent) => void>();

  const rejectPending = (reason: string) => {
    for (const command of pending.values()) {
      clearTimeout(command.timer);
      command.reject(new Error(reason));
    }
    pending.clear();
  };

  const onMessage = (payload: unknown) => {
    if (
      !isRecord(payload) ||
      payload.sessionId !== sessionId ||
      typeof payload.message !== "string"
    ) {
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(payload.message);
    } catch {
      return;
    }
    if (!isRecord(message)) return;

    if (
      typeof message.id === "number" &&
      Number.isSafeInteger(message.id)
    ) {
      const command = pending.get(message.id);
      if (!command) return;
      pending.delete(message.id);
      clearTimeout(command.timer);
      if ("error" in message) {
        command.reject(new Error(CDP_COMMAND_ERROR));
      } else {
        command.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== "string") return;
    const event = Object.freeze({
      method: message.method,
      params: message.params,
    });
    for (const listener of eventListeners) listener(event);
  };

  const onDetached = (payload: unknown) => {
    if (isRecord(payload) && payload.sessionId === sessionId) {
      rejectPending(CDP_COMMAND_ERROR);
    }
  };

  try {
    root.on("Target.receivedMessageFromTarget", onMessage);
    root.on("Target.detachedFromTarget", onDetached);
  } catch {
    try {
      root.off("Target.receivedMessageFromTarget", onMessage);
      root.off("Target.detachedFromTarget", onDetached);
    } catch {
      // The public error remains constant-safe.
    }
    throw new Error(CDP_COMMAND_ERROR);
  }

  return Object.freeze({
    async send(
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<unknown> {
      if (
        disposed ||
        typeof method !== "string" ||
        method.length === 0 ||
        !isRecord(params)
      ) {
        throw new Error(CDP_COMMAND_ERROR);
      }

      const id = nextCommandId++;
      let message: string;
      try {
        message = JSON.stringify({ id, method, params });
      } catch {
        throw new Error(CDP_COMMAND_ERROR);
      }
      const result = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(new Error(CDP_COMMAND_TIMEOUT_ERROR));
        }, commandTimeoutMs);
        pending.set(id, { resolve, reject, timer });
      });

      void withTimeout(
        Promise.resolve().then(() =>
          root.send("Target.sendMessageToTarget", {
            sessionId,
            message,
          }),
        ),
        commandTimeoutMs,
        CDP_COMMAND_TIMEOUT_ERROR,
      ).catch((error: unknown) => {
        const command = pending.get(id);
        if (command) {
          pending.delete(id);
          clearTimeout(command.timer);
          command.reject(
            new Error(
              error instanceof Error &&
                error.message === CDP_COMMAND_TIMEOUT_ERROR
                ? CDP_COMMAND_TIMEOUT_ERROR
                : CDP_COMMAND_ERROR,
            ),
          );
        }
      });
      return result;
    },

    onEvent(listener: (event: NestedCdpEvent) => void): () => void {
      if (disposed || typeof listener !== "function") {
        throw new Error(CDP_COMMAND_ERROR);
      }
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      let cleanupFailed = false;
      try {
        root.off("Target.receivedMessageFromTarget", onMessage);
        root.off("Target.detachedFromTarget", onDetached);
      } catch {
        cleanupFailed = true;
      }
      eventListeners.clear();
      rejectPending(CDP_COMMAND_ERROR);
      try {
        await withTimeout(
          root.send("Target.detachFromTarget", { sessionId }),
          commandTimeoutMs,
          CDP_CLEANUP_ERROR,
        );
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) throw new Error(CDP_CLEANUP_ERROR);
    },
  });
}

function safeTimeout(value: number): number {
  return Number.isSafeInteger(value) && value > 0 && value <= 30_000
    ? value
    : DEFAULT_ATTESTATION_TIMEOUT_MS;
}

async function attestLoadedWorkerSources(
  browserSession: CDPSession,
  targetId: string,
  artifacts: readonly TrustedChromiumWorkerArtifact[],
): Promise<void> {
  let transport: NestedCdpTransport | undefined;
  let removeEventListener: (() => void) | undefined;
  let attachedSessionId: string | undefined;
  let sourceFailed = false;
  let cleanupFailed = false;
  try {
    const attached = await withDefaultCdpTimeout(
      browserSession.send("Target.attachToTarget", {
        targetId,
        // Playwright 1.60's public CDPSession API cannot route flattened
        // sessionId commands, so this public-API adapter uses nested messages.
        flatten: false,
      }),
    );
    if (
      !isRecord(attached) ||
      typeof attached.sessionId !== "string" ||
      attached.sessionId.length === 0
    ) {
      throw new Error();
    }
    attachedSessionId = attached.sessionId;
    transport = createNestedCdpTransport(
      browserSession as unknown as RootCdpSession,
      attachedSessionId,
    );

    const scriptIdsByUrl = new Map<string, string[]>();
    removeEventListener = transport.onEvent((event) => {
      if (event.method !== "Debugger.scriptParsed" || !isRecord(event.params)) {
        return;
      }
      const { scriptId, url } = event.params;
      if (typeof scriptId !== "string" || typeof url !== "string") return;
      const scriptIds = scriptIdsByUrl.get(url) ?? [];
      scriptIds.push(scriptId);
      scriptIdsByUrl.set(url, scriptIds);
    });
    await transport.send("Debugger.enable");

    const loadedSources: LoadedWorkerSource[] = [];
    for (const artifact of artifacts) {
      const scriptIds = scriptIdsByUrl.get(artifact.absoluteUrl);
      if (!scriptIds || scriptIds.length !== 1) throw new Error();
      const sourceResult = await transport.send("Debugger.getScriptSource", {
        scriptId: scriptIds[0],
      });
      if (
        !isRecord(sourceResult) ||
        typeof sourceResult.scriptSource !== "string"
      ) {
        throw new Error();
      }
      loadedSources.push({
        absoluteUrl: artifact.absoluteUrl,
        source: sourceResult.scriptSource,
      });
    }
    assertTrustedLoadedWorkerSources(loadedSources, artifacts);
  } catch {
    sourceFailed = true;
  }

  removeEventListener?.();
  if (transport) {
    try {
      await transport.send("Debugger.disable");
    } catch {
      cleanupFailed = true;
    }
    try {
      await transport.dispose();
    } catch {
      cleanupFailed = true;
    }
  } else if (attachedSessionId) {
    try {
      await withDefaultCdpTimeout(
        browserSession.send("Target.detachFromTarget", {
          sessionId: attachedSessionId,
        }),
      );
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw new Error(CDP_CLEANUP_ERROR);
  if (sourceFailed) throw new Error(LOADED_SOURCE_ERROR);
}

export async function startChromiumWorkerAttestation(
  page: Page,
  expectedScope: string,
  artifacts: readonly TrustedChromiumWorkerArtifact[],
): Promise<ChromiumWorkerAttestation> {
  let context: BrowserContext | undefined;
  let pageSession: CDPSession | undefined;
  let browserSession: CDPSession | undefined;
  let responseListener:
    | ((response: Response) => void)
    | undefined;
  let registrationListener: ((payload: unknown) => void) | undefined;
  let versionListener: ((payload: unknown) => void) | undefined;

  try {
    const trustedByUrl = validatedArtifactMap(artifacts);
    const scopeUrl = new URL(expectedScope);
    if (
      scopeUrl.protocol !== "https:" ||
      scopeUrl.username !== "" ||
      scopeUrl.password !== "" ||
      scopeUrl.search !== "" ||
      scopeUrl.hash !== "" ||
      scopeUrl.pathname !== "/" ||
      artifacts.some(
        (artifact) =>
          new URL(artifact.pathname, expectedScope).toString() !==
          artifact.absoluteUrl,
      )
    ) {
      throw new Error();
    }
    const expectedScriptUrl = new URL("/sw.js", expectedScope).toString();
    if (!trustedByUrl.has(expectedScriptUrl)) throw new Error();

    context = page.context();
    const responsePromises = new Map<
      string,
      Array<Promise<InitialBrowserResponse | null>>
    >();
    const responseWaiters = new Set<() => void>();
    responseListener = (response: Response) => {
      const absoluteUrl = response.url();
      if (!trustedByUrl.has(absoluteUrl)) return;
      let isWorkerRequest = false;
      try {
        isWorkerRequest =
          response.request().serviceWorker() !== null &&
          response.request().url() === absoluteUrl;
      } catch {
        isWorkerRequest = false;
      }
      if (!isWorkerRequest) return;

      const pending = (async (): Promise<InitialBrowserResponse | null> => {
        try {
          if (response.status() !== 200) throw new Error();
          return {
            absoluteUrl,
            body: await response.body(),
          };
        } catch {
          return null;
        }
      })();
      const captures = responsePromises.get(absoluteUrl) ?? [];
      captures.push(pending);
      responsePromises.set(absoluteUrl, captures);
      for (const wake of responseWaiters) wake();
    };
    context.on("response", responseListener);

    const browser = context.browser();
    if (!browser) throw new Error();
    pageSession = await withDefaultCdpTimeout(
      context.newCDPSession(page),
    );
    browserSession = await withDefaultCdpTimeout(
      browser.newBrowserCDPSession(),
    );

    const registrations = new Map<string, Record<string, unknown>>();
    const versions = new Map<string, Record<string, unknown>>();
    let protocolInvalid = false;
    const versionWaiters = new Set<() => void>();
    const wakeVersionWaiters = () => {
      for (const wake of versionWaiters) wake();
    };
    registrationListener = (payload: unknown) => {
      if (!isRecord(payload) || !Array.isArray(payload.registrations)) {
        protocolInvalid = true;
        wakeVersionWaiters();
        return;
      }
      for (const registration of payload.registrations) {
        if (
          !isRecord(registration) ||
          typeof registration.registrationId !== "string"
        ) {
          protocolInvalid = true;
          continue;
        }
        registrations.set(registration.registrationId, registration);
      }
      wakeVersionWaiters();
    };
    versionListener = (payload: unknown) => {
      if (!isRecord(payload) || !Array.isArray(payload.versions)) {
        protocolInvalid = true;
        wakeVersionWaiters();
        return;
      }
      for (const version of payload.versions) {
        if (!isRecord(version) || typeof version.versionId !== "string") {
          protocolInvalid = true;
          continue;
        }
        versions.set(version.versionId, version);
      }
      wakeVersionWaiters();
    };
    pageSession.on(
      "ServiceWorker.workerRegistrationUpdated",
      registrationListener,
    );
    pageSession.on("ServiceWorker.workerVersionUpdated", versionListener);

    const targetInfo = await withDefaultCdpTimeout(
      pageSession.send("Target.getTargetInfo"),
    );
    if (
      !isRecord(targetInfo) ||
      !isRecord(targetInfo.targetInfo) ||
      typeof targetInfo.targetInfo.targetId !== "string" ||
      targetInfo.targetInfo.targetId.length === 0
    ) {
      throw new Error();
    }
    const pageTargetId = targetInfo.targetInfo.targetId;
    await withDefaultCdpTimeout(
      pageSession.send("ServiceWorker.enable"),
    );

    const waitForInitialResponses = async (
      timeoutMs: number,
    ): Promise<InitialBrowserResponse[]> => {
      const deadline = Date.now() + timeoutMs;
      while (
        [...trustedByUrl.keys()].some(
          (absoluteUrl) => !responsePromises.get(absoluteUrl)?.length,
        )
      ) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(BROWSER_RESPONSE_ERROR);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            responseWaiters.delete(wake);
            reject(new Error(BROWSER_RESPONSE_ERROR));
          }, remaining);
          const wake = () => {
            clearTimeout(timer);
            responseWaiters.delete(wake);
            resolve();
          };
          responseWaiters.add(wake);
        });
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(BROWSER_RESPONSE_ERROR);
      const results = await withTimeout(
        Promise.all([...responsePromises.values()].flat()),
        remaining,
        BROWSER_RESPONSE_ERROR,
      );
      if (results.some((result) => result === null)) {
        throw new Error(BROWSER_RESPONSE_ERROR);
      }
      return results as InitialBrowserResponse[];
    };

    const waitForActivatedTarget = async (
      timeoutMs: number,
    ): Promise<{ targetId: string; versionId: string }> => {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        if (!protocolInvalid) {
          try {
            return selectActivatedWorkerTarget(
              {
                registrations: [...registrations.values()],
                versions: [...versions.values()],
              },
              expectedScope,
              expectedScriptUrl,
              pageTargetId,
            );
          } catch {
            // A transient installing/waiting version may still become redundant.
          }
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(VERSION_ERROR);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            versionWaiters.delete(wake);
            reject(new Error(VERSION_ERROR));
          }, remaining);
          const wake = () => {
            clearTimeout(timer);
            versionWaiters.delete(wake);
            resolve();
          };
          versionWaiters.add(wake);
        });
      }
    };

    let disposed = false;
    return Object.freeze({
      async verifyActivatedController(
        timeoutMs = DEFAULT_ATTESTATION_TIMEOUT_MS,
      ): Promise<void> {
        if (disposed) throw new Error(SETUP_ERROR);
        const boundedTimeout = safeTimeout(timeoutMs);
        try {
          // The caller awaits registration.update() first. A round trip on
          // this same CDP session is the event barrier for its version events.
          await withDefaultCdpTimeout(
            pageSession.send("Runtime.evaluate", {
              expression: "void 0",
              returnByValue: true,
            }),
          );
        } catch {
          throw new Error(VERSION_ERROR);
        }
        const initialResponses =
          await waitForInitialResponses(boundedTimeout);
        assertTrustedInitialBrowserResponses(
          initialResponses,
          artifacts,
        );
        const activated = await waitForActivatedTarget(boundedTimeout);
        if (!browserSession) throw new Error(SETUP_ERROR);
        await attestLoadedWorkerSources(
          browserSession,
          activated.targetId,
          artifacts,
        );
      },

      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        let cleanupFailed = false;
        if (context && responseListener) {
          try {
            context.off("response", responseListener);
          } catch {
            cleanupFailed = true;
          }
        }
        responseWaiters.clear();
        versionWaiters.clear();
        if (pageSession && registrationListener) {
          try {
            pageSession.off(
              "ServiceWorker.workerRegistrationUpdated",
              registrationListener,
            );
          } catch {
            cleanupFailed = true;
          }
        }
        if (pageSession && versionListener) {
          try {
            pageSession.off(
              "ServiceWorker.workerVersionUpdated",
              versionListener,
            );
          } catch {
            cleanupFailed = true;
          }
        }
        if (pageSession) {
          try {
            await withDefaultCdpTimeout(
              pageSession.send("ServiceWorker.disable"),
            );
          } catch {
            cleanupFailed = true;
          }
          try {
            await withDefaultCdpTimeout(pageSession.detach());
          } catch {
            cleanupFailed = true;
          }
        }
        if (browserSession) {
          try {
            await withDefaultCdpTimeout(browserSession.detach());
          } catch {
            cleanupFailed = true;
          }
        }
        if (cleanupFailed) throw new Error(CLEANUP_ERROR);
      },
    });
  } catch {
    if (context && responseListener) {
      try {
        context.off("response", responseListener);
      } catch {
        // Setup still fails closed with a constant-safe error.
      }
    }
    if (pageSession && registrationListener) {
      try {
        pageSession.off(
          "ServiceWorker.workerRegistrationUpdated",
          registrationListener,
        );
      } catch {
        // Setup still fails closed with a constant-safe error.
      }
    }
    if (pageSession && versionListener) {
      try {
        pageSession.off(
          "ServiceWorker.workerVersionUpdated",
          versionListener,
        );
      } catch {
        // Setup still fails closed with a constant-safe error.
      }
    }
    if (pageSession) {
      try {
        await withDefaultCdpTimeout(
          pageSession.send("ServiceWorker.disable"),
        );
      } catch {
        // Setup still fails closed with a constant-safe error.
      }
      try {
        await withDefaultCdpTimeout(pageSession.detach());
      } catch {
        // Setup still fails closed with a constant-safe error.
      }
    }
    if (browserSession) {
      try {
        await withDefaultCdpTimeout(browserSession.detach());
      } catch {
        // Setup still fails closed with a constant-safe error.
      }
    }
    throw new Error(SETUP_ERROR);
  }
}
