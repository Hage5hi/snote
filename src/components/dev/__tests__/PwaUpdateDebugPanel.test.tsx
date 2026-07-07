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

  it("omits (renders em-dash) when lastRemoteBuildId absent", () => {
    setState({
      currentBuildId: "build-a",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: null,
    });
    render(<PwaUpdateDebugPanel />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/last remote:\s*—/)).toBeInTheDocument();
  });

  it("also handles explicit null lastRemoteBuildId without crashing", () => {
    setState({
      currentBuildId: "build-a",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: null,
      lastRemoteBuildId: null,
    });
    render(<PwaUpdateDebugPanel />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/last remote:\s*—/)).toBeInTheDocument();
  });
});
