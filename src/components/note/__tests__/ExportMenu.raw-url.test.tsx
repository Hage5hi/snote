import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportMenu } from "@/components/note/topbar/ExportMenu";
import { CANONICAL_ORIGIN } from "@/lib/capability/url";
import { dict } from "@/i18n/catalog";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY } from "@/i18n";

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast: (args: unknown) => toastSpy(args),
  useToast: () => ({ toast: toastSpy, dismiss: () => {}, toasts: [] }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const writeText = vi.fn(async () => {});

function Wrap({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, "en");
  toastSpy.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => cleanup());

describe("ExportMenu raw markdown URL", () => {
  it("copies the canonical RawView URL instead of the Edge dump", async () => {
    render(
      <Wrap>
        <ExportMenu slug="demo" getContent={() => "hello"} isEncrypted={false} />
      </Wrap>,
    );

    fireEvent.click(screen.getByRole("button", { name: dict.en["export.raw"] }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${CANONICAL_ORIGIN}/demo.md`);
    expect(String(writeText.mock.calls.at(0)?.at(0))).not.toContain("functions/v1/raw");
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith({
        title: dict.en["toast.copied_raw"],
        description: dict.en["toast.copied_raw_desc"],
      });
    });
  });

  it("does not copy a raw URL when the note is encrypted", () => {
    render(
      <Wrap>
        <ExportMenu slug="demo" getContent={() => "hello"} isEncrypted />
      </Wrap>,
    );

    const item = screen.getByRole("button", { name: dict.en["export.raw"] });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(writeText).not.toHaveBeenCalled();
  });
});
