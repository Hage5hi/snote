/** @vitest-environment node */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  verifyLiveRelease,
  type FetchLike,
  type LiveReleaseInput,
} from "../verify-live-release";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const validInput: LiveReleaseInput = {
  baseUrl: "https://note.syrin.online",
  expectedSha: SHA,
  expectedCapabilityRoutesEnabled: "false",
};

function manifestResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "private, no-store");
  }
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status: 200, ...init, headers },
  );
}

function recordingFetch(response: Response): {
  fetchImpl: FetchLike;
  calls: Array<{ url: URL; init: RequestInit }>;
} {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response;
    },
  };
}

async function rejectionMessage(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("Expected operation to reject");
}

describe("live release attestation", () => {
  it("accepts the exact SHA and disabled capability state", async () => {
    const { fetchImpl, calls } = recordingFetch(manifestResponse({
      buildId: "build-1",
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    }));

    await expect(verifyLiveRelease(validInput, fetchImpl)).resolves.toEqual({
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe("https://note.syrin.online/version.json");
    expect(calls[0]?.init).toMatchObject({
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache, no-store",
        Pragma: "no-cache",
      },
    });
  });

  it("accepts an explicitly enabled capability state", async () => {
    const { fetchImpl } = recordingFetch(manifestResponse({
      deployedSha: SHA,
      capabilityRoutesEnabled: true,
    }));

    await expect(verifyLiveRelease({
      ...validInput,
      expectedCapabilityRoutesEnabled: "true",
    }, fetchImpl)).resolves.toEqual({
      deployedSha: SHA,
      capabilityRoutesEnabled: true,
    });
  });

  it.each([
    [{ expectedSha: "" }, /40-character lowercase/],
    [{ expectedSha: SHA.toUpperCase() }, /40-character lowercase/],
    [{ expectedSha: "abc" }, /40-character lowercase/],
    [{ expectedCapabilityRoutesEnabled: "0" }, /exactly true or false/],
    [{ expectedCapabilityRoutesEnabled: "False" }, /exactly true or false/],
    [{ baseUrl: "ftp://note.syrin.online" }, /absolute HTTP or HTTPS/],
  ])("rejects invalid expected input before fetch: %o", async (override, message) => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      throw new Error("must not fetch");
    };

    await expect(
      verifyLiveRelease({ ...validInput, ...override }, fetchImpl),
    ).rejects.toThrow(message);
    expect(calls).toBe(0);
  });

  it("rejects network failures with a generic error", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("provider URL with private details");
    };
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
      "Unable to fetch live release manifest.",
    );
  });

  it("requires HTTP 200 without echoing the response body", async () => {
    const secret = "body-must-not-be-logged";
    const { fetchImpl } = recordingFetch(new Response(secret, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    }));
    const message = await rejectionMessage(
      verifyLiveRelease(validInput, fetchImpl),
    );
    expect(message).toBe("Live release manifest returned HTTP 503.");
    expect(message).not.toContain(secret);
  });

  it("requires the no-store cache directive", async () => {
    const { fetchImpl } = recordingFetch(manifestResponse({
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    }, { headers: { "Cache-Control": "no-cache" } }));
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
      /must use Cache-Control: no-store/,
    );
  });

  it.each([
    "x=\"foo,no-store,bar\"",
    "x=\"foo\\\",no-store,bar\"",
    "no-store, x=\"unterminated",
  ])("rejects no-store hidden by malformed or quoted directives: %s", async (
    cacheControl,
  ) => {
    const { fetchImpl } = recordingFetch(manifestResponse({
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    }, { headers: { "Cache-Control": cacheControl } }));
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
      /must use Cache-Control: no-store/,
    );
  });

  it("accepts no-store outside a quoted directive", async () => {
    const { fetchImpl } = recordingFetch(manifestResponse({
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    }, { headers: { "Cache-Control": "x=\"foo,bar\", No-Store" } }));
    await expect(verifyLiveRelease(validInput, fetchImpl)).resolves.toEqual({
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    });
  });

  it.each([null, [], "\"text\"", 42])(
    "rejects a non-object manifest: %o",
    async (body) => {
      const { fetchImpl } = recordingFetch(manifestResponse(body));
      await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
        "Live release manifest must be a JSON object.",
      );
    },
  );

  it("rejects malformed JSON", async () => {
    const { fetchImpl } = recordingFetch(manifestResponse("{"));
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
      "Live release manifest is not valid JSON.",
    );
  });

  it.each([
    [{ capabilityRoutesEnabled: false }, /SHA does not match/],
    [{ deployedSha: null, capabilityRoutesEnabled: false }, /SHA does not match/],
    [{ deployedSha: OTHER_SHA, capabilityRoutesEnabled: false }, /SHA does not match/],
    [{ deployedSha: SHA }, /capability route state does not match/],
    [{ deployedSha: SHA, capabilityRoutesEnabled: null }, /capability route state does not match/],
    [{ deployedSha: SHA, capabilityRoutesEnabled: "false" }, /capability route state does not match/],
    [{ deployedSha: SHA, capabilityRoutesEnabled: true }, /capability route state does not match/],
  ])("rejects stale or malformed fields: %o", async (body, message) => {
    const { fetchImpl } = recordingFetch(manifestResponse(body));
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(message);
  });
});

describe("post-deploy workflow wiring", () => {
  const workflow = readFileSync(
    resolve(".github/workflows/pwa-update-smoke-post-deploy.yml"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("requires the expected deployed SHA for manual runs", () => {
    expect(workflow).toMatch(
      / {6}expected_sha:\n {8}description: Exact deployed commit SHA expected in \/version\.json\n {8}required: true\n {8}type: string/,
    );
  });

  it("requires the expected capability route state for manual runs", () => {
    expect(workflow).toMatch(
      / {6}expected_capability_routes_enabled:\n {8}description: Expected capability route state in \/version\.json\n {8}required: true\n {8}type: choice\n {8}default: "false"\n {8}options:\n {10}- "false"\n {10}- "true"/,
    );
  });

  it("passes the deployment identity expectations through job env", () => {
    expect(workflow).toMatch(
      / {6}EXPECTED_DEPLOYED_SHA: >-\n {8}\$\{\{\n {10}github\.event_name == 'deployment_status' &&\n {10}github\.event\.deployment\.sha \|\|\n {10}inputs\.expected_sha\n {8}\}\}/,
    );
    expect(workflow).toMatch(
      / {6}EXPECTED_CAPABILITY_ROUTES_ENABLED: >-\n {8}\$\{\{\n {10}github\.event_name == 'deployment_status' &&\n {10}'false' \|\|\n {10}inputs\.expected_capability_routes_enabled\n {8}\}\}/,
    );
  });

  it("attests the live release before install and smoke checks", () => {
    expect(workflow).toMatch(
      / {6}- uses: oven-sh\/setup-bun@v2\n {8}with:\n {10}bun-version: 1\.3\.14\n {6}- name: Verify live release identity\n {8}run: bun run scripts\/verify-live-release\.ts\n/,
    );

    const attestationIndex = workflow.indexOf(
      "name: Verify live release identity",
    );
    expect(attestationIndex).toBeGreaterThan(-1);

    for (const laterStep of [
      "run: bun install --frozen-lockfile",
      "scripts/verify-frame-ancestors.sh",
      "run: bunx playwright install --with-deps chromium",
      "name: Run post-deploy smoke",
    ]) {
      expect(workflow.indexOf(laterStep)).toBeGreaterThan(attestationIndex);
    }
  });
});
