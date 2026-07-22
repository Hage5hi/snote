import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { LockButton } from "../LockButton";

const harness = vi.hoisted(() => ({
  upsert: vi.fn(),
  markEncrypted: vi.fn(),
  clearPin: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ upsert: (...args: unknown[]) => harness.upsert(...args) }),
  },
}));
vi.mock("@/lib/encryption-pin", () => ({
  markNoteEncrypted: (slug: string) => harness.markEncrypted(slug),
  clearNoteEncryptionPin: (slug: string) => harness.clearPin(slug),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => harness.toast(...args) }));
vi.mock("@/i18n/index", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/crypto", () => ({
  deriveKey: vi.fn().mockResolvedValue({}),
  encryptBytes: vi.fn().mockResolvedValue(new Uint8Array([1])),
  generatePassphrase: () => "generated-passphrase",
  makeCheck: vi.fn().mockResolvedValue("check"),
  randomSalt: () => "salt",
  PBKDF2_ITERATIONS: 1000,
}));
vi.mock("@/lib/yjs/base64", () => ({ bytesToBase64: () => "encoded" }));
vi.mock("lucide-react", () => ({
  Lock: () => null,
  LockOpen: () => null,
  KeyRound: () => null,
  Loader2: () => null,
  RotateCw: () => null,
  Copy: () => null,
}));

function Button({
  children,
  variant: _variant,
  size: _size,
  asChild: _asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: string;
  asChild?: boolean;
}) {
  return <button {...props}>{children}</button>;
}

vi.mock("@/components/ui/button", () => ({ Button }));
vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("LockButton encryption downgrade pin", () => {
  beforeEach(() => {
    harness.upsert.mockReset();
    harness.markEncrypted.mockReset();
    harness.clearPin.mockReset();
    harness.toast.mockReset();
    harness.markEncrypted.mockReturnValue(true);
    harness.clearPin.mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("pins only after the encrypted server upsert succeeds", async () => {
    const pending = deferred<{ error: null }>();
    harness.upsert.mockReturnValue(pending.promise);
    const view = render(<LockButton slug="secret" doc={new Y.Doc()} isEncrypted={false} />);

    fireEvent.change(view.getByPlaceholderText("lock.placeholder"), {
      target: { value: "safe passphrase" },
    });
    fireEvent.click(view.getByText("lock.encrypt_btn"));
    expect(harness.markEncrypted).not.toHaveBeenCalled();

    pending.resolve({ error: null });
    await waitFor(() => expect(harness.markEncrypted).toHaveBeenCalledWith("secret"));
  });

  it("clears only after the explicit plaintext upsert succeeds", async () => {
    const pending = deferred<{ error: null }>();
    harness.upsert.mockReturnValue(pending.promise);
    const view = render(<LockButton slug="secret" doc={new Y.Doc()} isEncrypted />);

    fireEvent.click(view.getByText("lock.unlock"));
    expect(harness.clearPin).not.toHaveBeenCalled();

    pending.resolve({ error: null });
    await waitFor(() => expect(harness.clearPin).toHaveBeenCalledWith("secret"));
  });

  it("retains the pin when explicit decryption fails", async () => {
    harness.upsert.mockResolvedValue({ error: new Error("write failed") });
    const view = render(<LockButton slug="secret" doc={new Y.Doc()} isEncrypted />);

    fireEvent.click(view.getByText("lock.unlock"));

    await waitFor(() => expect(harness.upsert).toHaveBeenCalled());
    expect(harness.clearPin).not.toHaveBeenCalled();
  });
});
