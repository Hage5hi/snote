import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITY_TOKEN_RE } from "../url";
import { newOwnerCandidate } from "../encoding";

describe("owner candidate encoding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes 32 random bytes as a 43-character capability token", () => {
    const bytes = new Uint8Array(32);
    bytes.fill(7);
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint8Array).set(bytes);
      return array;
    });

    const owner = newOwnerCandidate();

    expect(crypto.getRandomValues).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect((crypto.getRandomValues as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(32);
    expect(owner).toMatch(CAPABILITY_TOKEN_RE);
    expect(owner).toHaveLength(43);
    expect(owner).not.toMatch(/[+/=]/);
  });
});
