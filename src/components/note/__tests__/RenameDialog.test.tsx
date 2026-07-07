import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenameDialog } from "../RenameDialog";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  prepareRename: vi.fn(),
  finalizeRename: vi.fn(),
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
  finalizeRename: mocks.finalizeRename,
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

function renderDialog() {
  return render(
    <MemoryRouter initialEntries={["/old-slug"]}>
      <RenameDialog open onOpenChange={vi.fn()} currentSlug="old-slug" />
    </MemoryRouter>,
  );
}

describe("RenameDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.navigate.mockReset();
    mocks.toast.mockReset();
    mocks.prepareRename.mockResolvedValue(undefined);
    mocks.finalizeRename.mockResolvedValue({ deletionConfirmed: false });
    mocks.maybeSingle.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-checks old slug deletion after finalize before showing a success toast", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { slug: "old-slug" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("rename.placeholder"), {
      target: { value: "new-slug" },
    });
    await vi.advanceTimersByTimeAsync(350);
    await waitFor(() => expect(screen.getByRole("button", { name: "rename.submit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "rename.submit" }));

    await vi.advanceTimersByTimeAsync(1_500);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());

    expect(mocks.maybeSingle).toHaveBeenCalledTimes(3);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "rename.toast_renamed",
        description: "/old-slug → /new-slug",
        variant: undefined,
      }),
    );
  });
});