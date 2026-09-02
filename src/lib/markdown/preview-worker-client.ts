// Singleton client over the preview Worker. The worker is lazy-created so the
// editor-only path never pays for Markdown parsing. A failed worker is always
// discarded; the next render intent gets a fresh retry.

import DOMPurify from "dompurify";

interface PendingRequest {
  worker: Worker;
  resolve: (html: string) => void;
  reject: (reason: Error) => void;
}

const ADD_ATTR = [
  "data-mermaid",
  "data-katex",
  "data-hljs-lang",
  "data-hljs-code",
  "data-md-copy",
  "data-preview-heading",
  "data-md-alert",
  "data-md-alert-title",
];

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, PendingRequest>();

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR });
}

function asError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) return reason;
  if (reason && typeof reason === "object") {
    const error = "error" in reason ? reason.error : undefined;
    if (error instanceof Error) return error;
    const message = "message" in reason ? reason.message : undefined;
    if (typeof message === "string" && message) return new Error(message);
  }
  return new Error(fallbackMessage);
}

function discardWorker(failedWorker: Worker, reason: Error): void {
  if (worker === failedWorker) worker = null;

  failedWorker.onmessage = null;
  failedWorker.onerror = null;

  for (const [id, request] of pending) {
    if (request.worker !== failedWorker) continue;
    pending.delete(id);
    request.reject(reason);
  }

  try {
    failedWorker.terminate();
  } catch {
    // Rejection above is the useful signal. A broken terminate implementation
    // must not leave callers waiting forever.
  }
}

function ensureWorker(): Worker {
  if (worker) return worker;

  const created = new Worker(new URL("./preview-worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    created.onmessage = (event: MessageEvent<{ id: number; html: string }>) => {
      const request = pending.get(event.data.id);
      if (!request || request.worker !== created) return;
      pending.delete(event.data.id);
      try {
        request.resolve(sanitize(event.data.html));
      } catch (reason) {
        request.reject(asError(reason, "Failed to sanitize preview HTML"));
      }
    };
    created.onerror = (event) => {
      event.preventDefault?.();
      discardWorker(created, asError(event, "Preview worker failed"));
    };
  } catch (reason) {
    try {
      created.terminate();
    } catch {
      // Preserve the setup failure as the request error.
    }
    throw reason;
  }
  worker = created;
  return created;
}

export function renderInWorker(text: string): Promise<string> {
  let activeWorker: Worker;
  try {
    activeWorker = ensureWorker();
  } catch (reason) {
    return Promise.reject(asError(reason, "Failed to start preview worker"));
  }

  return new Promise<string>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { worker: activeWorker, resolve, reject });
    try {
      activeWorker.postMessage({ id, text });
    } catch (reason) {
      discardWorker(activeWorker, asError(reason, "Failed to send preview work"));
    }
  });
}

export async function renderOnMainThread(text: string): Promise<string> {
  const { renderMarkdown } = await import("./preview-worker-renderer");
  return sanitize(renderMarkdown(text));
}

export function __resetPreviewWorkerForTests(): void {
  const activeWorker = worker;
  if (activeWorker) {
    discardWorker(activeWorker, new Error("Preview worker reset"));
  } else {
    const reason = new Error("Preview worker reset");
    for (const [id, request] of pending) {
      pending.delete(id);
      request.reject(reason);
    }
  }
  worker = null;
  nextId = 0;
}
