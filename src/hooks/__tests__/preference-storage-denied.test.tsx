import { act, renderHook } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useEink } from "../use-eink";
import { useFocusLine } from "../use-focus-line";
import { usePagination } from "../use-pagination";
import { useScrollSyncEnabled } from "../use-scroll-sync-enabled";
import { useTypewriterMode } from "../use-typewriter-mode";
import { useZenMode } from "../use-zen-mode";
import { clearRecents, removeRecent } from "@/lib/recent-notes";

const originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");

describe("preference hooks when localStorage is denied", () => {
  beforeAll(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("storage denied", "SecurityError");
      },
    });
  });

  afterAll(() => {
    if (originalStorage) Object.defineProperty(window, "localStorage", originalStorage);
    document.documentElement.classList.remove(
      "zen-mode",
      "typewriter-mode",
      "focus-line",
      "paginated",
      "eink",
    );
  });

  it("keeps all note display preferences usable in memory", () => {
    const zen = renderHook(() => useZenMode());
    const typewriter = renderHook(() => useTypewriterMode());
    const focusLine = renderHook(() => useFocusLine());
    const scrollSync = renderHook(() => useScrollSyncEnabled());
    const pagination = renderHook(() => usePagination());
    const eink = renderHook(() => useEink());

    expect(zen.result.current.zen).toBe(false);
    expect(typewriter.result.current.typewriter).toBe(false);
    expect(focusLine.result.current.focusLine).toBe(false);
    expect(scrollSync.result.current.enabled).toBe(true);
    expect(pagination.result.current.enabled).toBe(false);
    expect(eink.result.current.pref).toBe("auto");

    act(() => {
      zen.result.current.toggle();
      typewriter.result.current.toggle();
      focusLine.result.current.toggle();
      scrollSync.result.current.toggle();
      pagination.result.current.toggle();
      eink.result.current.setMode("on");
    });

    expect(zen.result.current.zen).toBe(true);
    expect(typewriter.result.current.typewriter).toBe(true);
    expect(focusLine.result.current.focusLine).toBe(true);
    expect(scrollSync.result.current.enabled).toBe(false);
    expect(pagination.result.current.enabled).toBe(true);
    expect(eink.result.current.pref).toBe("on");
  });

  it("keeps recent-note removal actions non-throwing", () => {
    expect(() => removeRecent("blocked-storage")).not.toThrow();
    expect(() => clearRecents()).not.toThrow();
  });
});
