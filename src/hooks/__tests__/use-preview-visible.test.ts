import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePreviewVisible, __resetPreviewMigrationForTests } from "../use-preview-visible";

// Helpers to control the matchMedia mock per-test.
type Listener = () => void;
let narrow = false;
let listeners: Listener[] = [];

function setViewport(isNarrow: boolean) {
  narrow = isNarrow;
  // Fire listeners synchronously to mimic mql change events.
  for (const l of listeners) l();
}

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

beforeEach(() => {
  narrow = false;
  listeners = [];
  // Restore real localStorage in case a prior test replaced it.
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(window, "localStorage", originalLocalStorageDescriptor);
  }
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const isNarrowQuery = query.includes("max-width: 899px");
      return {
        get matches() {
          return isNarrowQuery ? narrow : false;
        },
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (_: string, cb: Listener) => listeners.push(cb),
        removeEventListener: (_: string, cb: Listener) => {
          listeners = listeners.filter((l) => l !== cb);
        },
        dispatchEvent: () => false,
      };
    },
  });
  __resetPreviewMigrationForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(window, "localStorage", originalLocalStorageDescriptor);
  }
});

describe("usePreviewVisible — blocked / unavailable localStorage", () => {
  function blockStorage() {
    const throwIt = () => { throw new Error("SecurityError"); };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        return {
          getItem: throwIt,
          setItem: throwIt,
          removeItem: throwIt,
          clear: throwIt,
          key: throwIt,
          length: 0,
        } as unknown as Storage;
      },
    });
  }

  it("defaults ON on desktop when storage throws", () => {
    blockStorage();
    narrow = false;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(true);
  });

  it("defaults OFF on mobile when storage throws", () => {
    blockStorage();
    narrow = true;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(false);
  });

  it("toggle still works in-memory when storage is blocked", () => {
    blockStorage();
    narrow = false;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.visible).toBe(false);
  });
});

describe("usePreviewVisible — legacy migration runs once", () => {
  it("only migrates the legacy key on the first read", () => {
    window.localStorage.setItem("notes:preview-visible", "0");
    narrow = false;
    const first = renderHook(() => usePreviewVisible());
    expect(first.result.current.visible).toBe(false);
    expect(window.localStorage.getItem("notes:preview-visible")).toBeNull();

    // Manually re-add the legacy key — second hook instance must NOT
    // re-trigger migration (guard prevents drift if old code re-writes it).
    window.localStorage.setItem("notes:preview-visible", "1");
    window.localStorage.removeItem("notes:preview-visible:wide");
    const second = renderHook(() => usePreviewVisible());
    // Legacy key is left untouched the second time; default ON wins.
    expect(window.localStorage.getItem("notes:preview-visible")).toBe("1");
    expect(second.result.current.visible).toBe(true);
  });
});

describe("usePreviewVisible — default by viewport", () => {
  it("defaults ON for desktop (wide) on first visit", () => {
    narrow = false;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(true);
  });

  it("defaults OFF for mobile (narrow) on first visit", () => {
    narrow = true;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(false);
  });
});

describe("usePreviewVisible — F5 persistence per viewport", () => {
  it("desktop remembers ON across remount (F5)", () => {
    narrow = false;
    const first = renderHook(() => usePreviewVisible());
    expect(first.result.current.visible).toBe(true);
    first.unmount();

    const second = renderHook(() => usePreviewVisible());
    expect(second.result.current.visible).toBe(true);
  });

  it("mobile remembers OFF across remount (F5)", () => {
    narrow = true;
    const first = renderHook(() => usePreviewVisible());
    expect(first.result.current.visible).toBe(false);
    first.unmount();

    const second = renderHook(() => usePreviewVisible());
    expect(second.result.current.visible).toBe(false);
  });

  it("user toggle on desktop persists to next desktop session", () => {
    narrow = false;
    const first = renderHook(() => usePreviewVisible());
    act(() => first.result.current.toggle());
    expect(first.result.current.visible).toBe(false);
    first.unmount();

    const second = renderHook(() => usePreviewVisible());
    expect(second.result.current.visible).toBe(false);
  });
});

describe("usePreviewVisible — no cross-viewport bleed", () => {
  it("toggling ON on mobile does NOT flip desktop default", () => {
    narrow = true;
    const mobile = renderHook(() => usePreviewVisible());
    act(() => mobile.result.current.toggle()); // mobile now ON
    expect(mobile.result.current.visible).toBe(true);
    mobile.unmount();

    // Fresh desktop session reads its own key — still ON by default.
    narrow = false;
    const desktop = renderHook(() => usePreviewVisible());
    expect(desktop.result.current.visible).toBe(true);
  });

  it("toggling OFF on desktop does NOT flip mobile default", () => {
    narrow = false;
    const desktop = renderHook(() => usePreviewVisible());
    act(() => desktop.result.current.toggle()); // desktop now OFF
    expect(desktop.result.current.visible).toBe(false);
    desktop.unmount();

    // Fresh mobile session — still OFF by default, NOT carrying desktop's
    // explicit OFF as some "remembered" state either way.
    narrow = true;
    const mobile = renderHook(() => usePreviewVisible());
    expect(mobile.result.current.visible).toBe(false);
  });

  it("mobile user who turned preview ON does not poison desktop default", () => {
    // Mobile: explicit ON.
    narrow = true;
    const mobile = renderHook(() => usePreviewVisible());
    act(() => mobile.result.current.toggle());
    mobile.unmount();

    // Desktop F5: stays ON (its own default), unrelated to mobile choice.
    narrow = false;
    const desktop = renderHook(() => usePreviewVisible());
    expect(desktop.result.current.visible).toBe(true);

    // Desktop explicitly turns OFF.
    act(() => desktop.result.current.toggle());
    desktop.unmount();

    // Mobile F5: still ON (mobile's own stored choice), NOT desktop's OFF.
    narrow = true;
    const mobileAgain = renderHook(() => usePreviewVisible());
    expect(mobileAgain.result.current.visible).toBe(true);
  });
});

describe("usePreviewVisible — viewport resize swaps remembered state", () => {
  it("resizing desktop -> mobile shows mobile's remembered value, not desktop's", () => {
    narrow = false;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(true); // desktop default ON

    // Pretend user previously set mobile OFF (which is also its default).
    window.localStorage.setItem("notes:preview-visible:narrow", "0");

    act(() => setViewport(true));
    expect(result.current.visible).toBe(false);
  });

  it("resizing mobile -> desktop shows desktop's remembered value", () => {
    narrow = true;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(false); // mobile default OFF

    act(() => setViewport(false));
    expect(result.current.visible).toBe(true);
  });
});

describe("usePreviewVisible — legacy migration", () => {
  it("honors legacy key for desktop only", () => {
    window.localStorage.setItem("notes:preview-visible", "0");

    narrow = false;
    const desktop = renderHook(() => usePreviewVisible());
    expect(desktop.result.current.visible).toBe(false); // migrated
    desktop.unmount();

    // Mobile ignores the legacy key — defaults OFF either way, but the key
    // must not be used as a source of "ON" for mobile.
    window.localStorage.clear();
    window.localStorage.setItem("notes:preview-visible", "1");
    narrow = true;
    const mobile = renderHook(() => usePreviewVisible());
    expect(mobile.result.current.visible).toBe(false);
  });

  it("migrates legacy key into wide key and clears the legacy slot", () => {
    window.localStorage.setItem("notes:preview-visible", "0");
    narrow = false;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(false);
    expect(window.localStorage.getItem("notes:preview-visible:wide")).toBe("0");
    expect(window.localStorage.getItem("notes:preview-visible")).toBeNull();
  });
});

describe("usePreviewVisible — corrupted stored values fall back to default", () => {
  it("ignores garbage in the wide key and uses default ON", () => {
    window.localStorage.setItem("notes:preview-visible:wide", "yes");
    narrow = false;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(true);
  });

  it("ignores garbage in the narrow key and uses default OFF", () => {
    window.localStorage.setItem("notes:preview-visible:narrow", "true");
    narrow = true;
    const { result } = renderHook(() => usePreviewVisible());
    expect(result.current.visible).toBe(false);
  });
});
