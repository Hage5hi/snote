import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InstallPrompt } from "@/components/note/InstallPrompt";
import { dict } from "@/i18n/catalog";
import { I18nProvider } from "@/i18n/provider";
import { STORAGE_KEY } from "@/i18n";

function Wrap({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, "en");
  localStorage.setItem("lang.ip_detected", "1");
});

afterEach(() => cleanup());

function appTrigger() {
  return screen.getByRole("button", { name: dict.en["install.title"] });
}

describe("InstallPrompt BIP dialog", () => {
  it("opens the install-as-app dialog on mouse down so a sibling hydrate cannot swallow the click", () => {
    let hydrateSibling: () => void = () => {
      throw new Error("hydrate not bound");
    };
    function Harness() {
      const [hydrated, setHydrated] = useState(false);
      hydrateSibling = () => setHydrated(true);
      return (
        <Wrap>
          <InstallPrompt />
          {hydrated ? <div data-testid="template-picker">template-picker</div> : null}
        </Wrap>
      );
    }

    render(<Harness />);

    fireEvent.mouseDown(appTrigger());
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
    ).not.toBeInTheDocument();

    act(() => {
      hydrateSibling();
    });
    expect(screen.getByTestId("template-picker")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("still opens the install-as-app dialog from a click (keyboard / fallback path)", () => {
    render(
      <Wrap>
        <InstallPrompt />
      </Wrap>,
    );

    fireEvent.click(appTrigger());
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
    ).not.toBeInTheDocument();
  });

  it("opens on mouse down after beforeinstallprompt and shows the in-dialog Install button", () => {
    render(
      <Wrap>
        <InstallPrompt />
      </Wrap>,
    );

    act(() => {
      const ev = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
      };
      ev.prompt = async () => {};
      ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
      window.dispatchEvent(ev);
    });

    fireEvent.mouseDown(appTrigger());
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
    ).toBeVisible();
  });

  it("returns focus to the trigger when Escape closes the dialog", async () => {
    const user = userEvent.setup();
    render(
      <Wrap>
        <InstallPrompt />
      </Wrap>,
    );

    const trigger = appTrigger();
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
