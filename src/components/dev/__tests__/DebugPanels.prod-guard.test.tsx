// Guards that both dev overlay panels stay hidden in prod-like builds.
// If someone accidentally removes the DEV/env gate, these tests fail loudly
// so the panels never leak to end users on the published site.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DiagnosticsPanel } from "@/components/dev/DiagnosticsPanel";
import { UrlSanitizeDebugPanel } from "@/components/dev/UrlSanitizeDebugPanel";

type EnvBag = Record<string, unknown>;
const env = import.meta.env as EnvBag;

const KEYS = ["DEV", "VITE_DEBUG_DIAGNOSTICS_PANEL", "VITE_DEBUG_URL_SANITIZE_PANEL"] as const;

function withEnv(overrides: Partial<Record<(typeof KEYS)[number], unknown>>) {
  const snapshot: EnvBag = {};
  for (const k of KEYS) snapshot[k] = env[k];
  Object.assign(env, overrides);
  return () => Object.assign(env, snapshot);
}

describe("DiagnosticsPanel prod-build guard", () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    cleanup();
  });

  it("renders nothing when DEV=false and no flag", () => {
    restore = withEnv({ DEV: false, VITE_DEBUG_DIAGNOSTICS_PANEL: undefined });
    const { container } = render(<DiagnosticsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when flag is a falsy string", () => {
    restore = withEnv({ DEV: false, VITE_DEBUG_DIAGNOSTICS_PANEL: "0" });
    const { container: c1 } = render(<DiagnosticsPanel />);
    expect(c1.firstChild).toBeNull();
    cleanup();
    restore();
    restore = withEnv({ DEV: false, VITE_DEBUG_DIAGNOSTICS_PANEL: "false" });
    const { container: c2 } = render(<DiagnosticsPanel />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders when explicit escape-hatch flag is set", () => {
    restore = withEnv({ DEV: false, VITE_DEBUG_DIAGNOSTICS_PANEL: "1" });
    const { container } = render(<DiagnosticsPanel />);
    expect(container.querySelector("[data-diagnostics-panel]")).not.toBeNull();
  });
});

describe("UrlSanitizeDebugPanel prod-build guard", () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    cleanup();
  });

  const renderPanel = () =>
    render(
      <MemoryRouter initialEntries={["/note/hello?utm_source=x&__lovable_load_id=abc"]}>
        <UrlSanitizeDebugPanel />
      </MemoryRouter>,
    );

  it("renders nothing when DEV=false and no flag", () => {
    restore = withEnv({ DEV: false, VITE_DEBUG_URL_SANITIZE_PANEL: undefined });
    const { container } = renderPanel();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when flag is a falsy string", () => {
    restore = withEnv({ DEV: false, VITE_DEBUG_URL_SANITIZE_PANEL: "0" });
    const { container: c1 } = renderPanel();
    expect(c1.firstChild).toBeNull();
    cleanup();
    restore();
    restore = withEnv({ DEV: false, VITE_DEBUG_URL_SANITIZE_PANEL: "false" });
    const { container: c2 } = renderPanel();
    expect(c2.firstChild).toBeNull();
  });

  it("renders when explicit escape-hatch flag is set and URL has stripped params", () => {
    restore = withEnv({ DEV: false, VITE_DEBUG_URL_SANITIZE_PANEL: "1" });
    const { container } = renderPanel();
    expect(container.querySelector("[data-url-sanitize-debug-panel]")).not.toBeNull();
  });
});
