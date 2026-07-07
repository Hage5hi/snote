import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenameDialog } from "../RenameDialog";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  prepareRename: vi.fn(),
  clearRenamedSlugLocalState: vi.fn(),
  finalizeRename: vi.fn(),
  waitForSlugDeletionConfirmed: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("@/hooks/use-toast", () => ({
  toast: mocks.toast,
}));

vi.mock("@/i18n/index", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("@/lib/rename", () => ({
  SLUG_RE: /^[a-zA-Z0-9_-]{1,64}$/,
  prepareRename: mocks.prepareRename,
  clearRenamedSlugLocalState: mocks.clearRenamedSlugLocalState,
  finalizeRename: mocks.finalizeRename,
  waitForSlugDeletionConfirmed: mocks.waitForSlugDeletionConfirmed,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          abortSignal: () => ({ maybeSingle: mocks.maybeSingle }),
          maybeSingle: mocks.maybeSingle,
        }),
      }),
    }),
  },
}));

function renderDialog(provider?: { saveSnapshot: () => Promise<void> }) {
  return render(
    <MemoryRouter initialEntries={["/old-slug"]}>
      <RenameDialog open onOpenChange={vi.fn()} currentSlug="old-slug" provider={provider as never} />
    </MemoryRouter>,
  );
}

describe("RenameDialog", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.toast.mockReset();
    mocks.prepareRename.mockReset();
    mocks.prepareRename.mockResolvedValue(undefined);
    mocks.clearRenamedSlugLocalState.mockReset();
    mocks.clearRenamedSlugLocalState.mockResolvedValue(undefined);
    mocks.finalizeRename.mockReset();
    mocks.finalizeRename.mockResolvedValue({ deletionConfirmed: false });
    mocks.waitForSlugDeletionConfirmed.mockReset();
    mocks.waitForSlugDeletionConfirmed.mockResolvedValue({ deleted: true, snapshot: null });
    mocks.maybeSingle.mockReset();
  });

  it("re-checks old slug deletion after finalize before showing a success toast", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("rename.placeholder"), {
      target: { value: "new-slug" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "rename.submit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "rename.submit" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());

    expect(mocks.clearRenamedSlugLocalState).toHaveBeenCalledWith("old-slug");
    expect(mocks.waitForSlugDeletionConfirmed).toHaveBeenCalledWith("old-slug");
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "rename.toast_renamed",
        description: "/old-slug → /new-slug",
        variant: undefined,
      }),
    );
  });

  it("shows a destructive warning toast if the old slug still exists after final recheck", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mocks.waitForSlugDeletionConfirmed.mockResolvedValueOnce({
      deleted: false,
      snapshot: { slug: "old-slug", char_count: 12, ydoc_state_len: 20, content_len: 12 },
    });

    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("rename.placeholder"), {
      target: { value: "new-slug" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "rename.submit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "rename.submit" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "rename.toast_renamed",
        description: "/old-slug → /new-slug (old slug still present — retry)",
        variant: "destructive",
      }),
    );
  });

  it("flushes the current provider snapshot before copying the row", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const provider = { saveSnapshot: vi.fn(() => Promise.resolve()) };

    renderDialog(provider);
    fireEvent.change(screen.getByPlaceholderText("rename.placeholder"), {
      target: { value: "new-slug" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "rename.submit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "rename.submit" }));

    await waitFor(() => expect(mocks.prepareRename).toHaveBeenCalled());
    expect(provider.saveSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prepareRename.mock.invocationCallOrder[0],
    );
  });
});