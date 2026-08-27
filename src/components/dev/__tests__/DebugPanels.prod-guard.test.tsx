// Guards that the dev overlay panels stay hidden in prod-like builds.
// If someone accidentally removes the DEV/env gate, these tests fail loudly
// so the panels never leak to end users on the published site.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DiagnosticsPanel } from "@/components/dev/DiagnosticsPanel";

type EnvBag = Record<string, unknown>;
const env = import.meta.env as EnvBag;

const KEYS = ["DEV", "VITE_DEBUG_DIAGNOSTICS_PANEL"] as const;

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
