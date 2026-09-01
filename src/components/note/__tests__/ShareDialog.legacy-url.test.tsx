import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "../ShareDialog";

const harness = vi.hoisted(() => ({
  openDialog: null as null | (() => void),
  qr: vi.fn(),
  copy: vi.fn(),
  shareToken: null as string | null,
  invoke: vi.fn(),
  manage: vi.fn(),
  capabilityClientImported: false,
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: (url: string) => {
    harness.qr(url);
    return Promise.resolve("data:image/png;base64,qr");
  } },
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) => {
    harness.openDialog = () => onOpenChange(true);
    return <>{children}</>;
  },
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: ReactNode }) => (
    <span onClick={() => harness.openDialog?.()}>{children}</span>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, asChild: _asChild, ...props }:
    ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; asChild?: boolean }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => harness.invoke(...args) } },
}));
vi.mock("@/lib/share-tokens", () => ({
  getShareToken: () => harness.shareToken,
  clearShareToken: vi.fn(),
}));
vi.mock("@/lib/capability/client", () => {
  harness.capabilityClientImported = true;
  return {
    createCapabilityApi: () => ({ manage: (...args: unknown[]) => harness.manage(...args) }),
  };
});
vi.mock("@/i18n/index", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react", () => ({
  Share2: () => null, Copy: () => null, Lock: () => null, Eye: () => null,
  Link2Off: () => null, Loader2: () => null,
}));

describe("ShareDialog legacy current URL containment", () => {
  beforeEach(() => {
    harness.qr.mockClear();
    harness.copy.mockClear();
    harness.invoke.mockReset();
    harness.manage.mockReset();
    harness.shareToken = null;
    harness.openDialog = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: harness.copy },
    });
  });

  it("uses the sanitized key-only URL for QR and Copy", async () => {
    const token = "a".repeat(43);
    window.history.replaceState(null, "", `/secret#owner=${token}&key=safe%20key`);
    const currentShareUrl = `${window.location.origin}/secret#safe%20key`;
    render(
      <ShareDialog
        slug="secret"
        isEncrypted
        currentShareUrl={currentShareUrl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.aria" }));
    await waitFor(() => expect(harness.qr).toHaveBeenCalledWith(currentShareUrl));
    fireEvent.click(screen.getByRole("button", { name: "brand.copy_url" }));
    await waitFor(() => expect(harness.copy).toHaveBeenCalledWith(currentShareUrl));
    expect(harness.qr.mock.calls.flat().join(" ")).not.toContain(token);
    expect(harness.copy.mock.calls.flat().join(" ")).not.toContain(token);
  });

  it("appends only the parsed encryption key to a legacy read-only link", async () => {
    const ownerToken = "a".repeat(43);
    harness.shareToken = "readonly-token";
    window.history.replaceState(
      null,
      "",
      `/secret#owner=${ownerToken}&key=safe%20key`,
    );
    render(
      <ShareDialog
        slug="secret"
        isEncrypted
        currentShareUrl={`${window.location.origin}/secret#safe%20key`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.aria" }));
    fireEvent.click(screen.getByLabelText("share.include_key"));
    fireEvent.click(screen.getByRole("button", { name: "share.copied_readonly_link" }));

    const expected = `${window.location.origin}/s/readonly-token#safe%20key`;
    await waitFor(() => expect(harness.copy).toHaveBeenCalledWith(expected));
    expect(harness.copy.mock.calls.flat().join(" ")).not.toContain(ownerToken);
  });
});

describe("ShareDialog share-create tombstone alignment", () => {
  beforeEach(() => {
    harness.qr.mockClear();
    harness.copy.mockClear();
    harness.invoke.mockReset();
    harness.manage.mockReset();
    harness.shareToken = null;
    harness.openDialog = null;
  });

  it("offers no legacy read-only link creation without a stored token", async () => {
    window.history.replaceState(null, "", "/secret");
    render(
      <ShareDialog
        slug="secret"
        isEncrypted={false}
        currentShareUrl={`${window.location.origin}/secret`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.aria" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "share.create_btn" })).toBeNull(),
    );
    expect(screen.queryByText("share.readonly_heading")).toBeNull();
  });

  it("still offers read-only link creation to capability owners", async () => {
    render(
      <ShareDialog
        slug="secret"
        isEncrypted={false}
        capabilityAccess={{ slug: "secret", scope: "owner", token: "a".repeat(43) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.aria" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "share.create_btn" })).toBeDefined(),
    );
    expect(screen.getByText("share.readonly_heading")).toBeDefined();
  });
});

describe("ShareDialog capability HTTP client loading", () => {
  beforeEach(() => {
    harness.qr.mockClear();
    harness.copy.mockClear();
    harness.invoke.mockReset();
    harness.manage.mockReset();
    harness.shareToken = null;
    harness.openDialog = null;
    harness.invoke.mockResolvedValue({ error: null });
    harness.manage.mockResolvedValue({
      rotated: { scope: "view", capability: "b".repeat(43) },
    });
  });

  it("does not import the capability client on the legacy share-revoke path", async () => {
    const importedBefore = harness.capabilityClientImported;
    harness.shareToken = "readonly-token";
    window.history.replaceState(null, "", "/secret");
    render(
      <ShareDialog
        slug="secret"
        isEncrypted={false}
        currentShareUrl={`${window.location.origin}/secret`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.aria" }));
    fireEvent.click(screen.getByRole("button", { name: "share.revoke_btn" }));

    await waitFor(() =>
      expect(harness.invoke).toHaveBeenCalledWith("share-revoke", { body: { token: "readonly-token" } }),
    );
    expect(harness.capabilityClientImported).toBe(importedBefore);
    expect(harness.manage).not.toHaveBeenCalled();
  });

  it("imports the capability client when an owner rotates a view link", async () => {
    const importedBefore = harness.capabilityClientImported;
    render(
      <ShareDialog
        slug="secret"
        isEncrypted={false}
        capabilityAccess={{ slug: "secret", scope: "owner", token: "a".repeat(43) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.aria" }));
    expect(harness.capabilityClientImported).toBe(importedBefore);

    fireEvent.click(screen.getByRole("button", { name: "share.create_btn" }));
    await waitFor(() => expect(harness.manage).toHaveBeenCalled());
    expect(harness.capabilityClientImported).toBe(true);
    expect(harness.invoke).not.toHaveBeenCalled();
    expect(harness.manage.mock.calls[0]).toEqual([
      "a".repeat(43),
      { action: "rotate", scope: "view" },
    ]);
  });
});
