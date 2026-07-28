import { render, waitFor } from "@testing-library/react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { Editor } from "../Editor";

describe("Editor encryption write fence", () => {
  it("gives the CodeMirror textbox an accessible name", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const view = render(<Editor doc={doc} awareness={awareness} />);

    await waitFor(() => expect(
      view.container.querySelector(".cm-content[role='textbox']"),
    ).toHaveAttribute("aria-label", "Markdown note editor"));
  });

  it("reconfigures CodeMirror to read-only while a provider transition is active", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const view = render(
      <Editor doc={doc} awareness={awareness} editable={false} />,
    );

    await waitFor(() => expect(
      view.container.querySelector(".cm-content"),
    ).toHaveAttribute("contenteditable", "false"));

    view.rerender(<Editor doc={doc} awareness={awareness} editable />);
    await waitFor(() => expect(
      view.container.querySelector(".cm-content"),
    ).toHaveAttribute("contenteditable", "true"));
  });
});
