import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "../Editor";

describe("Editor find/replace wiring", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens the custom search panel on Ctrl+F instead of the default CodeMirror form", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const { container } = render(<Editor doc={doc} awareness={awareness} />);
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    });
    expect(container.querySelector(".cm-search")).toBeNull();
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
  });

  it("does not steal Ctrl+F from a focused INPUT", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const { container } = render(<Editor doc={doc} awareness={awareness} />);
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());

    const foreign = document.createElement("input");
    document.body.append(foreign);
    fireEvent.keyDown(foreign, { key: "f", ctrlKey: true });
    expect(container.querySelector("[data-testid='note-search-panel']")).toBeNull();
    foreign.remove();
  });
});
