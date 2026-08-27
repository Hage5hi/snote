/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  resolveReleaseIdentity,
  revalidateReleaseIdentity,
  type GitCommand,
} from "../release-identity";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function sequence(
  outputs: Array<string | Error>,
  calls: string[][] = [],
): GitCommand {
  let index = 0;
  return (args) => {
    calls.push([...args]);
    const value = outputs[index++];
    if (value instanceof Error) throw value;
    return value ?? "";
  };
}

function thrownError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected operation to throw");
}

describe("release identity", () => {
  it("leaves ordinary builds explicitly unattested without calling Git", () => {
    const calls: string[][] = [];

    expect(resolveReleaseIdentity({}, sequence([], calls))).toEqual({
      strict: false,
      deployedSha: null,
    });
    expect(calls).toEqual([]);
  });

  it("accepts an exact approved SHA from a clean matching checkout", () => {
    const calls: string[][] = [];

    expect(
      resolveReleaseIdentity(
        { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A },
        sequence([`${SHA_A}\n`, ""], calls),
      ),
    ).toEqual({ strict: true, deployedSha: SHA_A });
    expect(calls).toEqual([
      ["rev-parse", "HEAD"],
      ["status", "--porcelain", "--untracked-files=all"],
    ]);
  });

  it.each([
    [{ SNOTE_REQUIRE_RELEASE_SHA: "1" }, /requires SNOTE_RELEASE_SHA/],
    [
      { SNOTE_REQUIRE_RELEASE_SHA: "0", SNOTE_RELEASE_SHA: SHA_A },
      /omitted or exactly/,
    ],
    [{ SNOTE_RELEASE_SHA: SHA_A }, /only accepted/],
    [
      { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: "ABC" },
      /40-character/,
    ],
    [
      { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A.toUpperCase() },
      /lowercase/,
    ],
    [
      { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: ` ${SHA_A}` },
      /exact 40-character/,
    ],
  ])("rejects partial or malformed configuration", (env, message) => {
    expect(() => resolveReleaseIdentity(env, sequence([]))).toThrow(message);
  });

  it("rejects a dirty checkout", () => {
    expect(() =>
      resolveReleaseIdentity(
        { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A },
        sequence([`${SHA_A}\n`, " M vite.config.ts\n"]),
      ),
    ).toThrow(/clean Git checkout/);
  });

  it("rejects a SHA that differs from HEAD", () => {
    expect(() =>
      resolveReleaseIdentity(
        { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A },
        sequence([`${SHA_B}\n`, ""]),
      ),
    ).toThrow(/does not match/);
  });

  it("fails closed with a generic error when Git is unavailable", () => {
    const error = thrownError(() =>
      resolveReleaseIdentity(
        { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A },
        sequence([new Error("secret git failure")]),
      ),
    );

    expect(error.message).toBe("A strict release build requires a clean Git checkout.");
  });

  it("returns null for ordinary bundle-time revalidation without calling Git", () => {
    const calls: string[][] = [];

    expect(
      revalidateReleaseIdentity(
        { strict: false, deployedSha: null },
        sequence([], calls),
      ),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it("revalidates the identity immediately before bundle emission", () => {
    const identity = { strict: true as const, deployedSha: SHA_A };
    expect(
      revalidateReleaseIdentity(identity, sequence([`${SHA_A}\n`, ""])),
    ).toBe(SHA_A);
    expect(() =>
      revalidateReleaseIdentity(identity, sequence([`${SHA_B}\n`, ""])),
    ).toThrow(/changed during the build/);
    expect(() =>
      revalidateReleaseIdentity(identity, sequence([`${SHA_A}\n`, "?? drift\n"])),
    ).toThrow(/changed during the build/);
    const error = thrownError(() =>
      revalidateReleaseIdentity(
        identity,
        sequence([new Error("secret bundle git failure")]),
      ),
    );
    expect(error.message).toBe("Strict release identity changed during the build.");
  });
});
