// Singleton client over the preview Worker. Lazy-create worker on first
// call so the editor-only path never pays for it. Tracks pending requests
// by monotonic ID; the latest call wins (older ones can still resolve but
// caller should guard against stale state — see Preview.tsx).

import DOMPurify from "dompurify";

type Resolver = (html: string) => void;

const ADD_ATTR = ["data-mermaid", "data-katex", "data-hljs-lang", "data-hljs-code"];

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Resolver>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./preview-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent<{ id: number; html: string }>) => {
    const cb = pending.get(e.data.id);
    if (cb) {
      pending.delete(e.data.id);
      const safe = DOMPurify.sanitize(e.data.html, { ADD_ATTR });
      cb(safe);
    }
  };
  worker.onerror = (e) => {
    console.warn("preview-worker error", e);
  };
  return worker;
}

export function renderInWorker(text: string): Promise<string> {
  const w = ensureWorker();
  return new Promise<string>((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    w.postMessage({ id, text });
  });
}

export function __resetPreviewWorkerForTests(): void {
  worker?.terminate();
  worker = null;
  nextId = 0;
  pending.clear();
}

// rebuild trigger: phase5 republish
