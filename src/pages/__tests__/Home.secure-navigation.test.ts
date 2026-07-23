import { describe, expect, it, vi } from "vitest";
import { softNavigate } from "@/lib/soft-navigate";

describe("secure create navigation", () => {
  it("resolves only after a deferred View Transition commits the owner URL", async () => {
    let commit: (() => void) | undefined;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (callback: () => void) => {
        commit = callback;
        return {};
      },
    });
    const navigate = vi.fn();

    const committed = softNavigate(navigate, "/daily#owner=secret");

    expect(committed).toBeInstanceOf(Promise);
    expect(navigate).not.toHaveBeenCalled();
    commit?.();
    await committed;
    expect(navigate).toHaveBeenCalledWith("/daily#owner=secret");
  });
});
