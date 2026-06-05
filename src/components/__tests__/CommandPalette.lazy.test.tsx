import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Count how many times the dynamic `import('./CommandPaletteBody')` actually
// resolves. The shell is supposed to NOT pull the body on mount — only after
// the user opens the palette via Ctrl/⌘+K.
let bodyImportCount = 0;

vi.mock("../CommandPaletteBody", () => {
  bodyImportCount++;
  return {
    default: (props: { open: boolean; onOpenChange: (v: boolean) => void }) =>
      props.open ? <div data-testid="cmdk-body">body open</div> : null,
  };
});

vi.mock("../ShortcutHelp", () => ({
  ShortcutHelp: () => null,
}));

beforeEach(() => {
  bodyImportCount = 0;
  vi.resetModules();
});

async function renderShell() {
  // Import after the mocks above are registered.
  const { CommandPalette } = await import("../CommandPalette");
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

describe("CommandPalette — lazy body loading", () => {
  it("does not import the body on initial mount", async () => {
    await renderShell();
    // Give React a microtask to flush; no Suspense should resolve.
    await Promise.resolve();
    expect(bodyImportCount).toBe(0);
    expect(screen.queryByTestId("cmdk-body")).toBeNull();
  });

  it("imports the body exactly once after first Ctrl+K", async () => {
    await renderShell();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("cmdk-body")).toBeInTheDocument());
    expect(bodyImportCount).toBe(1);

    // Toggle off + on again — module is already in the registry, so import
    // count must not grow on subsequent opens.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("cmdk-body")).toBeInTheDocument());
    expect(bodyImportCount).toBe(1);
  });

  it("supports ⌘+K (metaKey) as well as Ctrl+K", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "K", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("cmdk-body")).toBeInTheDocument());
  });
});
