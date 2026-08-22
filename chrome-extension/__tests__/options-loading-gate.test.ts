/**
 * Regression tests for the options-page initialization race observed on CI,
 * plus its fail-closed contract:
 *
 *  - the form is inert and reports data-settings-ready="false" until BOTH
 *    the synced settings and the local telemetry preference have loaded
 *    (either callback order);
 *  - controls are enabled and the attribute flips to "true" only then —
 *    this attribute is the deterministic ready signal E2E waits on (no
 *    fixed sleeps);
 *  - if either storage read fails (chrome.runtime.lastError), the form
 *    NEVER becomes ready, a visible reload hint is announced, and Save
 *    cannot overwrite preferences from an unconfirmed initial state.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML = readFileSync(resolve(__dirname, "../options.html"), "utf8");

type GetCb = (s: Record<string, unknown>) => void;

interface ChromeMock {
  storage: {
    sync: {
      get: (d: Record<string, unknown>, cb: GetCb) => void;
      set: (data: Record<string, unknown>, cb: () => void) => void;
    };
    local: {
      get: (d: Record<string, unknown>, cb: GetCb) => void;
      set: (data: Record<string, unknown>, cb?: () => void) => void;
      remove: (key: string, cb?: () => void) => void;
    };
    onChanged: { addListener: (fn: unknown) => void };
  };
  runtime: { lastError: { message: string } | null };
}

import { initOptions } from "../options.js";

let heldSyncGet: GetCb | null = null;
let heldLocalGet: GetCb | null = null;
let syncGetFails = false;
let localGetFails = false;
let stored: Record<string, unknown> = {};
let syncSetCalls: Record<string, unknown>[] = [];
let chromeRef: ChromeMock;

function mountWithHeldStorage() {
  heldSyncGet = null;
  heldLocalGet = null;
  syncGetFails = false;
  localGetFails = false;
  stored = {};
  syncSetCalls = [];
  const chromeMock: ChromeMock = {
    storage: {
      sync: {
        get: (_d, cb) => {
          heldSyncGet = cb;
        },
        set: (data, cb) => {
          syncSetCalls.push(data);
          Object.assign(stored, data);
          cb();
        },
      },
      local: {
        get: (_d, cb) => {
          heldLocalGet = cb;
        },
        set: (_data, cb) => cb?.(),
        remove: (_key, cb) => cb?.(),
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { lastError: null },
  };
  document.documentElement.innerHTML = HTML.replace(/<script[\s\S]*?<\/script>/, "");
  (globalThis as unknown as { chrome: ChromeMock }).chrome = chromeMock;
  chromeRef = chromeMock;
  initOptions();
}

/** Runs the held sync read; simulates chrome.runtime.lastError when asked. */
function runSyncRead(settings?: Record<string, unknown>) {
  if (syncGetFails) {
    chromeRef.runtime.lastError = { message: "sync read failed" };
    heldSyncGet!(settings ?? {});
    chromeRef.runtime.lastError = null;
  } else {
    heldSyncGet!(settings ?? {});
  }
}

function runLocalRead(value = false) {
  if (localGetFails) {
    chromeRef.runtime.lastError = { message: "local read failed" };
    heldLocalGet!({ "syrin:telemetryEnabled": value });
    chromeRef.runtime.lastError = null;
  } else {
    heldLocalGet!({ "syrin:telemetryEnabled": value });
  }
}

function form(): HTMLElement {
  const el = document.getElementById("settings");
  if (!el) throw new Error("missing #settings form");
  return el;
}

function readyState(): string | null {
  return form().getAttribute("data-settings-ready");
}

/** All interactive controls, each required to exist — no fallbacks. */
function controls(): HTMLInputElement[] {
  const ids = ["defaultSlug", "debug", "telemetryEnabled", "clearDiagnostics", "save"];
  const found = ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing #${id}`);
    return el as HTMLInputElement;
  });
  for (const value of ["home", "slug", "last"]) {
    const radio = form().querySelector(`input[name="openMode"][value="${value}"]`);
    if (!radio) throw new Error(`missing openMode radio ${value}`);
    found.push(radio as HTMLInputElement);
  }
  return found;
}

const allDisabled = () => controls().every((c) => c.disabled);
const allEnabled = () => controls().every((c) => !c.disabled);

function submit() {
  form().dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

beforeEach(() => {
  document.documentElement.innerHTML = "<html><head></head><body></body></html>";
});

describe("options.js — loading gate (success orders)", () => {
  it("keeps the form inert and not ready while storage callbacks are pending", () => {
    mountWithHeldStorage();

    expect(readyState()).toBe("false");
    expect(allDisabled()).toBe(true);
  });

  it("stays not ready after only the telemetry preference loads (local-first order)", () => {
    mountWithHeldStorage();

    runLocalRead(true);
    expect(readyState()).toBe("false");
    expect(allDisabled()).toBe(true);
  });

  it("stays not ready after only the synced settings load (sync-first order)", () => {
    mountWithHeldStorage();

    runSyncRead({ openMode: "slug", defaultSlug: "journal", debug: true });
    expect(readyState()).toBe("false");
    expect(allDisabled()).toBe(true);
  });

  it("becomes ready with restored values once both loads complete (local-first)", () => {
    mountWithHeldStorage();

    runLocalRead(true);
    runSyncRead({ openMode: "slug", defaultSlug: "journal", debug: true });

    expect(readyState()).toBe("true");
    expect(allEnabled()).toBe(true);
    const slug = document.getElementById("defaultSlug") as HTMLInputElement;
    expect(slug.value).toBe("journal");
    expect(slug.disabled).toBe(false);
    const radio = form().querySelector('input[name="openMode"][value="slug"]') as HTMLInputElement;
    expect(radio.checked).toBe(true);
    const telemetry = document.getElementById("telemetryEnabled") as HTMLInputElement;
    expect(telemetry.checked).toBe(true);
  });

  it("becomes ready once both loads complete in the sync-first order too", () => {
    mountWithHeldStorage();

    runSyncRead({ openMode: "slug", defaultSlug: "journal", debug: false });
    expect(readyState()).toBe("false");
    runLocalRead(false);

    expect(readyState()).toBe("true");
    expect(allEnabled()).toBe(true);
  });
});

describe("options.js — loading gate (fail-closed reads)", () => {
  it("never becomes ready when the synced-settings read fails", () => {
    mountWithHeldStorage();
    syncGetFails = true;

    runSyncRead();
    runLocalRead(true);

    expect(readyState()).toBe("false");
    expect(allDisabled()).toBe(true);
    const error = document.getElementById("loadError");
    expect(error, "load error region must exist").not.toBeNull();
    expect((error as HTMLElement).hidden).toBe(false);
  });

  it("never becomes ready when the telemetry read fails", () => {
    mountWithHeldStorage();
    localGetFails = true;

    runSyncRead({ openMode: "slug", defaultSlug: "journal", debug: true });
    runLocalRead();

    expect(readyState()).toBe("false");
    expect(allDisabled()).toBe(true);
    expect((document.getElementById("loadError") as HTMLElement).hidden).toBe(false);
  });

  it("does not let Save overwrite preferences from an unread initial state", () => {
    mountWithHeldStorage();
    localGetFails = true;
    runSyncRead({ openMode: "slug", defaultSlug: "journal", debug: true });
    runLocalRead();

    submit();

    expect(syncSetCalls).toEqual([]);
  });

  it("keeps the form inert when the markup loads without JS having run", () => {
    // The HTML alone must already disable everything: fieldsets disabled in
    // markup and the save button disabled in markup, so a JS crash or a
    // storage failure before init leaves the page fail-closed. JSDOM does
    // not propagate fieldset.disabled onto descendants' .disabled property,
    // so assert the effective state via the closest disabled ancestor.
    document.documentElement.innerHTML = HTML.replace(/<script[\s\S]*?<\/script>/, "");
    const effectivelyDisabled = controls().every((c) => {
      if (c.disabled) return true;
      const ancestor = c.closest("fieldset") as HTMLFieldSetElement | null;
      return ancestor?.disabled === true;
    });
    expect(effectivelyDisabled).toBe(true);
    expect(readyState()).toBe("false");
    expect(form().getAttribute("aria-busy")).toBe("true");
  });
});
