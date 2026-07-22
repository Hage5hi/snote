import { act, render, screen } from "@testing-library/react";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRenderCacheForTests, setCachedHtml } from "@/lib/markdown/render-cache";

const workerMocks = vi.hoisted(() => ({
  renderInWorker: vi.fn(),
  renderOnMainThread: vi.fn(),
}));

vi.mock("@/lib/markdown/preview-worker-client", () => workerMocks);
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: () => "Empty note" }) }));
vi.mock("@/lib/markdown/renderers/mermaid", () => ({ renderMermaid: vi.fn() }));
vi.mock("@/lib/markdown/renderers/katex", () => ({ renderKatex: vi.fn() }));
vi.mock("@/lib/markdown/renderers/highlight", () => ({ highlightCode: vi.fn() }));

import { Preview } from "../Preview";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDoc(content: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, content);
  return doc;
}

function replaceContent(doc: Y.Doc, content: string): void {
  const text = doc.getText("content");
  doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, content);
  });
}

async function runScheduledRender(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(160);
  });
}

describe("Preview render correctness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    workerMocks.renderInWorker.mockReset();
    workerMocks.renderOnMainThread.mockReset();
    __resetRenderCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a newer cache hit when an older cache miss resolves later", async () => {
    const oldRender = deferred<string>();
    workerMocks.renderInWorker.mockReturnValueOnce(oldRender.promise);
    setCachedHtml("B", "<p>B cached</p>");
    const doc = createDoc("A");

    const { container } = render(<Preview doc={doc} />);
    expect(workerMocks.renderInWorker).toHaveBeenCalledWith("A");

    act(() => replaceContent(doc, "B"));
    await runScheduledRender();
    expect(container.querySelector(".markdown-preview")?.innerHTML).toBe("<p>B cached</p>");

    await act(async () => oldRender.resolve("<p>A stale</p>"));
    expect(container.querySelector(".markdown-preview")?.innerHTML).toBe("<p>B cached</p>");
  });

  it("keeps the newest result when two cache misses resolve out of order", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    workerMocks.renderInWorker
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const doc = createDoc("A");

    const { container } = render(<Preview doc={doc} />);
    act(() => replaceContent(doc, "B"));
    await runScheduledRender();

    await act(async () => second.resolve("<p>B newest</p>"));
    expect(container.querySelector(".markdown-preview")?.innerHTML).toBe("<p>B newest</p>");

    await act(async () => first.resolve("<p>A stale</p>"));
    expect(container.querySelector(".markdown-preview")?.innerHTML).toBe("<p>B newest</p>");
  });

  it("uses the safe fallback after a worker failure and retries the worker later", async () => {
    workerMocks.renderInWorker
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("<p>worker recovered</p>");
    workerMocks.renderOnMainThread.mockResolvedValueOnce("<p>offline fallback</p>");
    const doc = createDoc("offline");

    render(<Preview doc={doc} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("offline fallback")).toBeInTheDocument();

    act(() => replaceContent(doc, "online"));
    await runScheduledRender();
    await act(async () => Promise.resolve());

    expect(workerMocks.renderInWorker).toHaveBeenNthCalledWith(2, "online");
    expect(screen.getByText("worker recovered")).toBeInTheDocument();
  });

  it("does not start fallback or update state after unmount when pending work rejects", async () => {
    const pending = deferred<string>();
    workerMocks.renderInWorker.mockReturnValueOnce(pending.promise);
    workerMocks.renderOnMainThread.mockResolvedValue("<p>too late</p>");
    const doc = createDoc("pending");

    const { unmount } = render(<Preview doc={doc} />);
    unmount();
    await act(async () => pending.reject(new Error("worker stopped")));

    expect(workerMocks.renderOnMainThread).not.toHaveBeenCalled();
  });
});
