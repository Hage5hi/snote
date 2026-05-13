import { describe, it, expect, vi, beforeEach } from "vitest";

describe("preview-worker-client", () => {
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((e: { data: { id: number; html: string } }) => void) | null;
    terminate: ReturnType<typeof vi.fn>;
    onerror: ((e: unknown) => void) | null;
  };

  beforeEach(() => {
    mockWorker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Worker = vi.fn(() => mockWorker);
  });

  it("resolves with html when worker replies", async () => {
    const { renderInWorker, __resetPreviewWorkerForTests } = await import(
      "../preview-worker-client"
    );
    __resetPreviewWorkerForTests();

    const p = renderInWorker("hello");
    expect(mockWorker.postMessage).toHaveBeenCalledWith({ id: 1, text: "hello" });

    mockWorker.onmessage!({ data: { id: 1, html: "<p>hello</p>" } });
    expect(await p).toBe("<p>hello</p>");
  });

  it("resolves each request independently in any reply order", async () => {
    const { renderInWorker, __resetPreviewWorkerForTests } = await import(
      "../preview-worker-client"
    );
    __resetPreviewWorkerForTests();

    const p1 = renderInWorker("a");
    const p2 = renderInWorker("b");

    mockWorker.onmessage!({ data: { id: 2, html: "<p>b</p>" } });
    mockWorker.onmessage!({ data: { id: 1, html: "<p>a</p>" } });

    expect(await p2).toBe("<p>b</p>");
    expect(await p1).toBe("<p>a</p>");
  });
});
