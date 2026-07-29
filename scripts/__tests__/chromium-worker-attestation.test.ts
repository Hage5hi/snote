import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTrustedInitialBrowserResponses,
  assertTrustedLoadedWorkerSources,
  createNestedCdpTransport,
  selectActivatedWorkerTarget,
  startChromiumWorkerAttestation,
  type TrustedChromiumWorkerArtifact,
} from "../../e2e/helpers/chromium-worker-attestation";
import { createTrustedWorkerArtifactDigest } from "../../e2e/helpers/production-readonly";

class FakeRootCdpSession extends EventEmitter {
  readonly send = vi.fn(
    async (
      _method: string,
      _params?: Record<string, unknown>,
    ): Promise<Record<string, never>> => ({}),
  );
}

const origin = "https://note.syrin.online";

function artifact(
  pathname: string,
  source: string,
): TrustedChromiumWorkerArtifact {
  return {
    ...createTrustedWorkerArtifactDigest(pathname, source),
    absoluteUrl: new URL(pathname, origin).toString(),
    source,
  };
}

describe("Chromium service-worker attestation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects only the activated version that controls the exact page", () => {
    const expectedScope = `${origin}/`;
    const expectedScriptUrl = `${origin}/sw.js`;
    const pageTargetId = "page-target";
    const snapshot = {
      registrations: [
        {
          registrationId: "registration",
          scopeURL: expectedScope,
          isDeleted: false,
        },
      ],
      versions: [
        {
          versionId: "old-version",
          registrationId: "registration",
          scriptURL: expectedScriptUrl,
          runningStatus: "stopped",
          status: "redundant",
          targetId: "",
          controlledClients: [],
        },
        {
          versionId: "active-version",
          registrationId: "registration",
          scriptURL: expectedScriptUrl,
          runningStatus: "running",
          status: "activated",
          targetId: "worker-target",
          controlledClients: [pageTargetId],
        },
      ],
    };

    expect(
      selectActivatedWorkerTarget(
        snapshot,
        expectedScope,
        expectedScriptUrl,
        pageTargetId,
      ),
    ).toEqual({
      targetId: "worker-target",
      versionId: "active-version",
    });

    const secret = "owner-edit-view-capability-secret";
    for (const invalid of [
      {
        ...snapshot,
        versions: [
          ...snapshot.versions,
          {
            versionId: secret,
            registrationId: "registration",
            scriptURL: expectedScriptUrl,
            runningStatus: "running",
            status: "installed",
            targetId: secret,
            controlledClients: [],
          },
        ],
      },
      {
        ...snapshot,
        registrations: [
          {
            registrationId: secret,
            scopeURL: expectedScope,
            isDeleted: true,
          },
        ],
      },
      {
        ...snapshot,
        versions: [
          {
            ...snapshot.versions[1],
            scriptURL: `${origin}/${secret}.js`,
          },
        ],
      },
      {
        ...snapshot,
        versions: [
          {
            ...snapshot.versions[1],
            controlledClients: [secret],
          },
        ],
      },
    ]) {
      let failure: unknown;
      try {
        selectActivatedWorkerTarget(
          invalid,
          expectedScope,
          expectedScriptUrl,
          pageTargetId,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "Chromium worker version attestation failed",
      );
      expect(JSON.stringify(failure)).not.toContain(secret);
    }
  });

  it("requires exact initial browser bodies for all trusted worker URLs", () => {
    const artifacts = [
      artifact("/sw.js", "self.importScripts('workbox.js')"),
      artifact("/workbox-9c191d2f.js", "self.workbox = true"),
      artifact(
        "/sw-identity-0123456789abcdef.js",
        "self.releaseIdentity = true",
      ),
    ];
    const responses = artifacts.map((trusted) => ({
      absoluteUrl: trusted.absoluteUrl,
      body: new TextEncoder().encode(trusted.source),
    }));
    expect(() =>
      assertTrustedInitialBrowserResponses(responses, artifacts),
    ).not.toThrow();

    const secret = "owner-edit-view-capability-secret";
    for (const invalid of [
      responses.slice(0, 2),
      responses.map((response, index) =>
        index === 1
          ? {
              ...response,
              body: new TextEncoder().encode(secret),
            }
          : response,
      ),
      [
        ...responses,
        {
          absoluteUrl: artifacts[0].absoluteUrl,
          body: new TextEncoder().encode(secret),
        },
      ],
    ]) {
      let failure: unknown;
      try {
        assertTrustedInitialBrowserResponses(invalid, artifacts);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "Chromium worker browser response attestation failed",
      );
      expect(JSON.stringify(failure)).not.toContain(secret);
    }
  });

  it("hashes the exact UTF-8 source loaded in the activated worker target", () => {
    const artifacts = [
      artifact("/sw.js", "const greeting = 'xin chào';"),
      artifact("/workbox-9c191d2f.js", "self.workbox = true"),
      artifact(
        "/sw-identity-0123456789abcdef.js",
        "self.releaseIdentity = true",
      ),
    ];
    const sources = artifacts.map(({ absoluteUrl, source }) => ({
      absoluteUrl,
      source,
    }));
    expect(() =>
      assertTrustedLoadedWorkerSources(sources, artifacts),
    ).not.toThrow();

    const secret = "owner-edit-view-capability-secret";
    for (const invalid of [
      sources.slice(0, 2),
      sources.map((source, index) =>
        index === 0 ? { ...source, source: secret } : source,
      ),
      [...sources, sources[0]],
    ]) {
      let failure: unknown;
      try {
        assertTrustedLoadedWorkerSources(invalid, artifacts);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "Chromium worker loaded source attestation failed",
      );
      expect(JSON.stringify(failure)).not.toContain(secret);
    }
  });

  it("correlates nested CDP replies by both id and exact session", async () => {
    const root = new FakeRootCdpSession();
    const transport = createNestedCdpTransport(
      root,
      "exact-session",
      1_000,
    );
    const result = transport.send("Debugger.enable");
    await vi.waitFor(() => {
      expect(root.send).toHaveBeenCalledTimes(1);
    });
    const sent = root.send.mock.calls[0];
    const payload = JSON.parse(
      (sent[1] as { message: string }).message,
    ) as { id: number };

    root.emit("Target.receivedMessageFromTarget", {
      sessionId: "wrong-session",
      message: JSON.stringify({ id: payload.id, result: { wrong: true } }),
    });
    root.emit("Target.receivedMessageFromTarget", {
      sessionId: "exact-session",
      message: JSON.stringify({ id: payload.id + 1, result: { wrong: true } }),
    });
    root.emit("Target.receivedMessageFromTarget", {
      sessionId: "exact-session",
      message: JSON.stringify({ id: payload.id, result: { enabled: true } }),
    });

    await expect(result).resolves.toEqual({ enabled: true });
    await expect(transport.dispose()).resolves.toBeUndefined();
    expect(root.listenerCount("Target.receivedMessageFromTarget")).toBe(0);
    expect(root.send).toHaveBeenLastCalledWith("Target.detachFromTarget", {
      sessionId: "exact-session",
    });
  });

  it("fails closed on nested command timeout and cleanup failure", async () => {
    vi.useFakeTimers();
    const root = new FakeRootCdpSession();
    const transport = createNestedCdpTransport(root, "session", 25);
    const pending = expect(
      transport.send("Debugger.getScriptSource", {
        scriptId: "owner-edit-view-capability-secret",
      }),
    ).rejects.toThrow("Chromium worker CDP command timed out");
    await vi.advanceTimersByTimeAsync(26);
    await pending;
    await transport.dispose();

    const stalledRoot = new FakeRootCdpSession();
    stalledRoot.send.mockImplementationOnce(
      async () => await new Promise<Record<string, never>>(() => {}),
    );
    const stalledTransport = createNestedCdpTransport(
      stalledRoot,
      "stalled-session",
      25,
    );
    const stalledCommand = expect(
      stalledTransport.send("Debugger.enable"),
    ).rejects.toThrow("Chromium worker CDP command timed out");
    await vi.advanceTimersByTimeAsync(26);
    await stalledCommand;
    stalledRoot.send.mockResolvedValue({});
    await stalledTransport.dispose();

    const secret = "owner-edit-view-capability-secret";
    const failingRoot = new FakeRootCdpSession();
    failingRoot.send.mockImplementation(async (method: string) => {
      if (method === "Target.detachFromTarget") {
        throw new Error(secret);
      }
      return {};
    });
    const failingTransport = createNestedCdpTransport(
      failingRoot,
      "cleanup-session",
      25,
    );
    let failure: unknown;
    try {
      await failingTransport.dispose();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Chromium worker CDP cleanup failed",
    );
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(
      failingRoot.listenerCount("Target.receivedMessageFromTarget"),
    ).toBe(0);

    const stalledCleanupRoot = new FakeRootCdpSession();
    stalledCleanupRoot.send.mockImplementation(async (method: string) => {
      if (method === "Target.detachFromTarget") {
        return await new Promise<Record<string, never>>(() => {});
      }
      return {};
    });
    const stalledCleanupTransport = createNestedCdpTransport(
      stalledCleanupRoot,
      "stalled-cleanup-session",
      25,
    );
    const stalledCleanup = expect(
      stalledCleanupTransport.dispose(),
    ).rejects.toThrow("Chromium worker CDP cleanup failed");
    await vi.advanceTimersByTimeAsync(26);
    await stalledCleanup;
  });

  it("exposes the pre-navigation Chromium attestation entry point", () => {
    expect(startChromiumWorkerAttestation).toBeTypeOf("function");
  });
});
