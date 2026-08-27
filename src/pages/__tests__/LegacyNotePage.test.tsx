import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LegacyNotePage from "../LegacyNotePage";

const harness = vi.hoisted(() => ({
  open: vi.fn(),
  previewText: vi.fn(),
  unlock: vi.fn(),
}));

vi.mock("@/lib/legacy/cutover", async (original) => {
  const actual = await original<typeof import("@/lib/legacy/cutover")>();
  return {
    ...actual,
    createLegacyNoteApi: () => ({ open: harness.open }),
  };
});
vi.mock("@/components/note/Preview", () => ({
  Preview: ({ doc }: { doc: import("yjs").Doc }) => {
    harness.previewText(doc.getText("content").toString());
    return <div data-testid="preview" />;
  },
}));
vi.mock("@/components/note/UnlockForm", () => ({
  UnlockForm: () => { harness.unlock(); return <div data-testid="unlock" />; },
}));
vi.mock("@/components/app/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("react-helmet-async", () => ({ Helmet: () => null }));
vi.mock("lucide-react", () => ({ ArrowLeft: () => null, CopyPlus: () => null, Eye: () => null, Loader2: () => null }));

describe("LegacyNotePage cutover mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/daily");
  });

  it("hydrates exact-match content into preview without mounting an editor", async () => {
    harness.open.mockResolvedValue({
      slug: "daily",
      content: "legacy text",
      ydocState: "",
      isEncrypted: false,
      salt: null,
      check: null,
      iterations: null,
    });

    render(<MemoryRouter><LegacyNotePage slug="daily" /></MemoryRouter>);

    await waitFor(() => expect(harness.previewText).toHaveBeenCalledWith("legacy text"));
    expect(screen.getByText("legacy.read_only")).toBeInTheDocument();
  });

  it("does not mount legacy ciphertext before unlock", async () => {
    harness.open.mockResolvedValue({
      slug: "daily",
      content: "",
      ydocState: "Y2lwaGVydGV4dA==",
      isEncrypted: true,
      salt: "salt",
      check: "check",
      iterations: 600_000,
    });

    render(<MemoryRouter><LegacyNotePage slug="daily" /></MemoryRouter>);

    await waitFor(() => expect(harness.unlock).toHaveBeenCalled());
    expect(harness.previewText).not.toHaveBeenCalled();
  });

  it.each(["note", "Privacy", "S"])(
    "disables secure duplication for router-owned target %s",
    async (targetSlug) => {
      harness.open.mockResolvedValue({
        slug: "daily",
        content: "legacy text",
        ydocState: "",
        isEncrypted: false,
        salt: null,
        check: null,
        iterations: null,
      });

      render(<MemoryRouter><LegacyNotePage slug="daily" /></MemoryRouter>);

      await waitFor(() => expect(screen.getByText("legacy.read_only")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("legacy.new_slug"), {
        target: { value: targetSlug },
      });

      expect(screen.getByLabelText("legacy.new_slug")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("button", { name: "legacy.duplicate_securely" })).toBeDisabled();
    },
  );
});
