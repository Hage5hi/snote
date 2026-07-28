import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "../ShareDialog";

const harness = vi.hoisted(() => ({
  openDialog: null as null | (() => void),
  qr: vi.fn(),
  copy: vi.fn(),
  shareToken: null as string | null,
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
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("@/lib/share-tokens", () => ({
  getShareToken: () => harness.shareToken,
  setShareToken: vi.fn(),
  clearShareToken: vi.fn(),
}));
vi.mock("@/lib/capability/client", () => ({ createCapabilityApi: () => ({ manage: vi.fn() }) }));
vi.mock("@/i18n/index", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react", () => ({
  Share2: () => null, Copy: () => null, Lock: () => null, Eye: () => null,
  Link2Off: () => null, Loader2: () => null,
}));

describe("ShareDialog legacy current URL containment", () => {
  beforeEach(() => {
    harness.qr.mockClear();
    harness.copy.mockClear();
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
