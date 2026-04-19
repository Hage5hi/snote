import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import * as Y from "yjs";

marked.setOptions({ gfm: true, breaks: true });

export function Preview({ doc, className }: { doc: Y.Doc; className?: string }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    const ytext = doc.getText("content");
    const render = () => {
      const raw = marked.parse(ytext.toString()) as string;
      setHtml(DOMPurify.sanitize(raw));
    };
    render();
    ytext.observe(render);
    return () => ytext.unobserve(render);
  }, [doc]);

  return (
    <div
      className={`prose prose-neutral dark:prose-invert max-w-none px-6 py-6 ${className ?? ""}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html || '<p class="text-muted-foreground">Empty note. Bắt đầu gõ để xem preview.</p>' }}
    />
  );
}
