/**
 * Regression tests for the options-page initialization race observed on CI:
 * the async chrome.storage.sync.get callback can land after the page is
 * interactive, overwrite whatever the user already entered back to storage
 * defaults, and the subsequent Save then persists the defaults while still
 * reporting "✓ Saved".
 *
 * The contract under test:
 *  - the form is inert and reports data-settings-ready="false" until BOTH
 *    the synced settings and the local telemetry preference have loaded;
 *  - controls are enabled and the attribute flips to "true" only then —
 *    this attribute is the deterministic ready signal E2E waits on (no
 *    fixed sleeps);
 *  - a late storage callback therefore cannot overwrite user input,
 *    because interaction is structurally impossible before it lands.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML = readFileSync(resolve(__dirname, "../options.html"), "utf8");

type GetCb = (s: Record<string, unknown>) => void;

interface ChromeMock {
  storage: {
    sync: { get: (d: Record<string, unknown>, cb: GetCb) => void; set: (data: Record<string, unknown>, cb: () => void) => void };
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
let stored: Record<string, unknown> = {};

function mountWithHeldStorage() {
  heldSyncGet = null;
  heldLocalGet = null;
  stored = {};
  const chromeMock: ChromeMock = {
    storage: {
      sync: {
        get: (_d, cb) => {
          heldSyncGet = cb;
        },
        set: (data, cb) => {
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
  initOptions();
}

function readyState(): string | null {
  return (document.getElementById("settings") as HTMLElement).getAttribute("data-settings-ready");
}

function controlsDisabled(): boolean[] {
  const ids = ["defaultSlug", "debug", "telemetryEnabled", "save", "clearDiagnostics"];
  return ids.map((id) => (document.getElementById(id) as HTMLButtonElement | null)?.disabled ?? true);
}

beforeEach(() => {
  document.documentElement.innerHTML = "<html><head></head><body></body></html>";
});

describe("options.js — loading gate", () => {
  it("keeps the form inert and not ready while storage callbacks are pending", () => {
    mountWithHeldStorage();

    expect(readyState()).toBe("false");
    expect(controlsDisabled().every(Boolean)).toBe(true);
  });

  it("stays not ready when only the telemetry preference has loaded", () => {
    mountWithHeldStorage();

    heldLocalGet!({ "syrin:telemetryEnabled": true });
    expect(readyState()).toBe("false");
    expect(controlsDisabled().every(Boolean)).toBe(true);
  });

  it("becomes ready with restored values once both loads complete", () => {
    mountWithHeldStorage();

    heldLocalGet!({ "syrin:telemetryEnabled": true });
    heldSyncGet!({ openMode: "slug", defaultSlug: "journal", debug: true });

    expect(readyState()).toBe("true");
    expect(controlsDisabled().every((d) => !d)).toBe(true);
    const slug = document.getElementById("defaultSlug") as HTMLInputElement;
    expect(slug.value).toBe("journal");
    expect(slug.disabled).toBe(false);
    const radio = document.querySelector('input[name="openMode"][value="slug"]') as HTMLInputElement;
    expect(radio.checked).toBe(true);
    const telemetry = document.getElementById("telemetryEnabled") as HTMLInputElement;
    expect(telemetry.checked).toBe(true);
  });

  it("flips the E2E-ready attribute, the deterministic wait signal", () => {
    mountWithHeldStorage();

    expect(readyState()).toBe("false");
    heldLocalGet!({ "syrin:telemetryEnabled": false });
    heldSyncGet!({ openMode: "home", defaultSlug: "", debug: false });
    expect(readyState()).toBe("true");
  });
});
