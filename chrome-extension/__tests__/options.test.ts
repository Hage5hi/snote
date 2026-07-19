/**
 * JSDOM tests for chrome-extension/options.js
 *
 * Mounts options.html into JSDOM, mocks chrome.storage.sync, then drives the
 * form via DOM events to verify validation, state, and save behaviour.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML = readFileSync(resolve(__dirname, "../options.html"), "utf8");

type GetCb = (s: Record<string, unknown>) => void;
type SetCb = () => void;

interface ChromeMock {
  storage: {
    sync: {
      get: (defaults: Record<string, unknown>, cb: GetCb) => void;
      set: (data: Record<string, unknown>, cb: SetCb) => void;
    };
    local: {
      get: (defaults: Record<string, unknown>, cb: GetCb) => void;
      set: (data: Record<string, unknown>, cb?: SetCb) => void;
    };
    onChanged: { addListener: (fn: unknown) => void };
  };
  runtime: { lastError: { message: string } | null };
}

// @ts-expect-error - plain JS module
import { initOptions } from "../options.js";

let stored: Record<string, unknown> = {};
let localStored: Record<string, unknown> = {};
let setShouldFail = false;
let chromeMock: ChromeMock;

async function loadOptions(initial: Record<string, unknown> = {}) {
  stored = { ...initial };
  localStored = {};
  setShouldFail = false;
  chromeMock = {
    storage: {
      sync: {
        get: vi.fn((defaults: Record<string, unknown>, cb: GetCb) => {
          const out = { ...defaults };
          for (const k of Object.keys(defaults)) {
            if (k in stored) out[k] = stored[k];
          }
          cb(out);
        }),
        set: vi.fn((data: Record<string, unknown>, cb: SetCb) => {
          if (setShouldFail) {
            chromeMock.runtime.lastError = { message: "quota" };
            cb();
            chromeMock.runtime.lastError = null;
          } else {
            Object.assign(stored, data);
            cb();
          }
        }),
      },
      local: {
        get: vi.fn((defaults: Record<string, unknown>, cb: GetCb) => {
          const out = { ...defaults };
          for (const k of Object.keys(defaults)) {
            if (k in localStored) out[k] = localStored[k];
          }
          cb(out);
        }),
        set: vi.fn((data: Record<string, unknown>, cb?: SetCb) => {
          Object.assign(localStored, data);
          cb?.();
        }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { lastError: null },
  };
  document.documentElement.innerHTML = HTML.replace(
    /<script[\s\S]*?<\/script>/,
    "",
  );
  (globalThis as unknown as { chrome: ChromeMock }).chrome = chromeMock;
  initOptions();
  await Promise.resolve();
}

function $(sel: string) {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as HTMLElement;
}

function radio(value: string) {
  return $(`input[name="openMode"][value="${value}"]`) as HTMLInputElement;
}

function submit() {
  ($("#settings") as HTMLFormElement).dispatchEvent(
    new Event("submit", { cancelable: true, bubbles: true }),
  );
}

beforeEach(() => {
  document.documentElement.innerHTML = "<html><head></head><body></body></html>";
});

describe("options.js — defaults loading", () => {
  it("defaults to home when storage empty", async () => {
    await loadOptions();
    expect(radio("home").checked).toBe(true);
    expect((document.getElementById("defaultSlug") as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("restores saved mode + slug + debug", async () => {
    await loadOptions({ openMode: "slug", defaultSlug: "journal", debug: true });
    expect(radio("slug").checked).toBe(true);
    expect((document.getElementById("defaultSlug") as HTMLInputElement).value).toBe("journal");
    expect((document.getElementById("debug") as HTMLInputElement).checked).toBe(true);
  });
});

describe("options.js — validation", () => {
  it("disables save when slug mode + empty slug", async () => {
    await loadOptions({ openMode: "slug", defaultSlug: "" });
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById("slugError") as HTMLElement).hidden).toBe(true);
  });

  it("shows error + disables save on invalid slug", async () => {
    await loadOptions({ openMode: "slug", defaultSlug: "" });
    const input = document.getElementById("defaultSlug") as HTMLInputElement;
    input.value = "has space";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect((document.getElementById("slugError") as HTMLElement).hidden).toBe(false);
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables save on valid slug", async () => {
    await loadOptions({ openMode: "slug", defaultSlug: "" });
    const input = document.getElementById("defaultSlug") as HTMLInputElement;
    input.value = "my-note";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect((document.getElementById("slugError") as HTMLElement).hidden).toBe(true);
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("switching to home enables slug input disabled state", async () => {
    await loadOptions({ openMode: "slug", defaultSlug: "x" });
    radio("home").checked = true;
    radio("home").dispatchEvent(new Event("change", { bubbles: true }));
    expect((document.getElementById("defaultSlug") as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("options.js — save", () => {
  it("persists mode=home and clears defaultSlug", async () => {
    await loadOptions({ openMode: "slug", defaultSlug: "old" });
    radio("home").checked = true;
    radio("home").dispatchEvent(new Event("change", { bubbles: true }));
    submit();
    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(
      { openMode: "home", defaultSlug: "", debug: false },
      expect.any(Function),
    );
    expect($("#status").textContent).toBe("✓ Saved");
  });

  it("persists mode=slug with valid slug + debug=true", async () => {
    await loadOptions();
    radio("slug").checked = true;
    radio("slug").dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.getElementById("defaultSlug") as HTMLInputElement;
    input.value = "daily";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const dbg = document.getElementById("debug") as HTMLInputElement;
    dbg.checked = true;
    dbg.dispatchEvent(new Event("change", { bubbles: true }));
    submit();
    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(
      { openMode: "slug", defaultSlug: "daily", debug: true },
      expect.any(Function),
    );
  });

  it("persists mode=last", async () => {
    await loadOptions();
    radio("last").checked = true;
    radio("last").dispatchEvent(new Event("change", { bubbles: true }));
    submit();
    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(
      { openMode: "last", defaultSlug: "", debug: false },
      expect.any(Function),
    );
  });

  it("does NOT save when validation fails", async () => {
    await loadOptions({ openMode: "slug", defaultSlug: "" });
    submit();
    expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
  });

  it("persists the local telemetry opt-out even when sync save fails", async () => {
    await loadOptions({ openMode: "home" });
    const telemetry = document.getElementById("telemetryEnabled") as HTMLInputElement;
    telemetry.checked = false;
    setShouldFail = true;

    submit();

    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      { "syrin:telemetryEnabled": false },
      expect.any(Function),
    );
    expect(localStored["syrin:telemetryEnabled"]).toBe(false);
  });

  it("shows error status when chrome.runtime.lastError set", async () => {
    await loadOptions({ openMode: "home" });
    setShouldFail = true;
    submit();
    expect($("#status").textContent).toBe("✗ Save failed");
  });
});
