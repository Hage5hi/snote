// Unit tests: PwaUpdateDebugPanel renders lastRemoteBuildId when provided
// and safely falls back when absent. The panel only mounts under DEV — the
// test env sets that via vitest defaults (import.meta.env.DEV === true).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PwaUpdateDebugPanel } from "../PwaUpdateDebugPanel";

type PwaState = {
  currentBuildId: string;
  pendingBuildId: string | null;
  updateAvailable: boolean;
  updateInProgress: boolean;
  reloadAttemptCount: number;
  reloadStrategy: "waiting-sw" | "hard" | null;
  lastRemoteBuildId?: string | null;
};

function setState(state: PwaState | undefined) {
  (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: PwaState }).__SNOTE_PWA_UPDATE_STATE__ = state;
}

afterEach(() => {
  setState(undefined);
  cleanup();
});

describe("PwaUpdateDebugPanel", () => {
  it("renders lastRemoteBuildId when provided", () => {
    setState({
      currentBuildId: "build-a",
      pendingBuildId: "build-b",
      updateAvailable: true,
      updateInProgress: false,
      reloadAttemptCount: 1,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-remote-xyz",
    });
    render(<PwaUpdateDebugPanel />);
    // Expand the panel.
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/last remote:\s*build-remote-xyz/)).toBeInTheDocument();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("safely omits lastRemoteBuildId when %s (renders em-dash, no crash, no leaked value)", (_label, value) => {
    setState({
      currentBuildId: "build-a",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: null,
      ...(value === null ? { lastRemoteBuildId: null } : {}),
    });
    render(<PwaUpdateDebugPanel />);
    fireEvent.click(screen.getByRole("button"));
    // Em-dash placeholder is rendered.
    expect(screen.getByText(/last remote:\s*—/)).toBeInTheDocument();
    // No literal "null" / "undefined" string leaked into the DOM row.
    expect(screen.queryByText(/last remote:\s*(null|undefined)/i)).not.toBeInTheDocument();
  });
});
