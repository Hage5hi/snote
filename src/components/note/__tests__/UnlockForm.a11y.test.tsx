import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnlockForm } from "../UnlockForm";

const harness = vi.hoisted(() => ({
  deriveKey: vi.fn(),
  verifyCheck: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  deriveKey: (...args: unknown[]) => harness.deriveKey(...args),
  verifyCheck: (...args: unknown[]) => harness.verifyCheck(...args),
}));
vi.mock("@/i18n/index", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  KeyRound: () => null,
  Loader2: () => null,
}));

function renderUnlock(embedded = false) {
  return render(
    <MemoryRouter initialEntries={["/secret"]}>
      <UnlockForm
        slug="secret"
        salt="salt"
        check="check"
        iterations={1}
        embedded={embedded}
        onUnlock={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("UnlockForm accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.deriveKey.mockResolvedValue({} as CryptoKey);
  });

  it("labels navigation, password input, descriptions, and errors", async () => {
    harness.verifyCheck.mockResolvedValue(false);
    renderUnlock();

    expect(screen.getByRole("link", { name: "share.back_home_aria" })).toBeInTheDocument();
    const input = screen.getByLabelText("unlock.placeholder");
    expect(input).toHaveAttribute("aria-describedby");

    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "unlock.submit" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("unlock.wrong_key");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("preserves the submit button's accessible name while busy", async () => {
    harness.deriveKey.mockReturnValue(new Promise(() => {}));
    renderUnlock();
    fireEvent.change(screen.getByLabelText("unlock.placeholder"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "unlock.submit" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "unlock.submit" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });
  });

  it("does not steal focus or force viewport height inside a split pane", () => {
    const { container } = renderUnlock(true);
    expect(screen.getByLabelText("unlock.placeholder")).not.toHaveFocus();
    expect(container.firstElementChild).toHaveClass("h-full");
    expect(container.firstElementChild).not.toHaveClass("min-h-svh");
  });
});
