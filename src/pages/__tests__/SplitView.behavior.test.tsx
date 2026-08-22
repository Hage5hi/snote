import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SplitView from "../SplitView";

const harness = vi.hoisted(() => ({
  noteProps: new Map<string, {
    embedNarrow?: boolean;
    legacyOnly?: boolean;
    onPrimaryScroller?: (element: HTMLElement | null) => void;
  }>(),
  observers: [] as Array<{
    callback: ResizeObserverCallback;
    elements: Set<Element>;
  }>,
}));

vi.mock("../NotePage", () => {
  const MockNotePage = (props: {
    embedSlug: string;
    embedNarrow?: boolean;
    legacyOnly?: boolean;
    onPrimaryScroller?: (element: HTMLElement | null) => void;
  }) => {
    harness.noteProps.set(props.embedSlug, props);
    return <div>note:{props.embedSlug}</div>;
  };
  return {
    default: MockNotePage,
    CutoverNotePage: MockNotePage,
  };
});
vi.mock("@/components/app/AppShell", () => ({
  AppShell: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-scene-theme", () => ({ useSceneTheme: () => ({ scene: "none" }) }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/split-view-persistence", () => ({ saveLastSplitView: vi.fn() }));
vi.mock("react-helmet-async", () => ({ Helmet: () => null }));
vi.mock("lucide-react", () => ({ ArrowLeft: () => null, Link2: () => null }));

function resize(element: Element, width: number) {
  const observer = harness.observers.find((candidate) => candidate.elements.has(element));
  if (!observer) throw new Error("No ResizeObserver is watching the requested element");
  act(() => {
    observer.callback(
      [{ target: element, contentRect: { width } as DOMRectReadOnly } as ResizeObserverEntry],
      observer as unknown as ResizeObserver,
    );
  });
}

function renderSplit(path = "/alpha+beta", legacyOnly?: boolean) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug" element={<SplitView legacyOnly={legacyOnly} />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SplitView responsive behavior", () => {
  beforeEach(() => {
    harness.noteProps.clear();
    harness.observers.length = 0;
    class ResizeObserverMock {
      private readonly record: (typeof harness.observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, elements: new Set() };
        harness.observers.push(this.record);
      }
      observe = (element: Element) => this.record.elements.add(element);
      unobserve = (element: Element) => this.record.elements.delete(element);
      disconnect = () => this.record.elements.clear();
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("uses accessible keyboard tabs in a narrow split container", async () => {
    const { container } = renderSplit();
    await screen.findByText("note:alpha");
    const workspace = container.querySelector("[data-split-workspace]");
    expect(workspace).not.toBeNull();

    resize(workspace!, 640);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "/alpha" })).not.toHaveAttribute("hidden");
    expect(container.querySelector("#split-panel-1")).toHaveAttribute("hidden");

    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "/beta" })).not.toHaveAttribute("hidden");
  });

  it("derives each embedded note's compact layout from its pane width", async () => {
    const { container } = renderSplit();
    await screen.findByText("note:alpha");
    const firstPane = container.querySelector("[data-split-view-pane='0']");
    expect(firstPane).not.toBeNull();

    resize(firstPane!, 720);

    expect(harness.noteProps.get("alpha")?.embedNarrow).toBe(true);
    expect(harness.noteProps.get("beta")?.embedNarrow).toBe(false);
  });

  it.each([
    [undefined, true],
    [false, false],
  ] as const)("forwards legacyOnly=%s to every pane", async (legacyOnly, expected) => {
    renderSplit("/alpha+beta", legacyOnly);
    await screen.findByText("note:alpha");

    expect(harness.noteProps.get("alpha")?.legacyOnly).toBe(expected);
    expect(harness.noteProps.get("beta")?.legacyOnly).toBe(expected);
  });

  it("exposes sync state to assistive technology", async () => {
    renderSplit();
    const toggle = await screen.findByRole("button", { name: /Sync scroll/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});
