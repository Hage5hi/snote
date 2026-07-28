import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SyncIndicator } from "../SyncIndicator";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/hooks/use-sync-status", () => ({
  useSyncStatus: () => ({
    status: "synced",
    pendingBytes: 0,
    lastBroadcastAt: 0,
    lastSnapshotAt: 0,
    lastErrorMessage: null,
    lastErrorAt: null,
    conflictPending: false,
    dismissError: vi.fn(),
    dismissConflict: vi.fn(),
  }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key === "sync.label.synced" ? "Synced" : key }),
}));

describe("SyncIndicator accessibility", () => {
  it("uses the contrast-safe foreground color for the synced label", () => {
    render(<SyncIndicator provider={null} />);

    expect(screen.getByRole("button", { name: "Synced" })).toHaveClass("text-foreground");
  });
});
