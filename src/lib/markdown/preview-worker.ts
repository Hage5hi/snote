// Web Worker entry. Receives `{ id, text }`, returns `{ id, html }` after
// rendering Markdown. Sanitization stays on the main thread because
// DOMPurify requires a DOM/window that Web Workers do not provide.

import { renderMarkdown } from "./preview-worker-renderer";

interface RequestMessage {
  id: number;
  text: string;
}

interface ResponseMessage {
  id: number;
  html: string;
}

self.onmessage = (event: MessageEvent<RequestMessage>) => {
  const { id, text } = event.data;
  const html = renderMarkdown(text);
  (self as unknown as Worker).postMessage({ id, html } as ResponseMessage);
};

export {};
