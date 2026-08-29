/** @vitest-environment node */

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
