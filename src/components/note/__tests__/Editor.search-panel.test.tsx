import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
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

  it("closes the open panel on Ctrl+F even when the Find input is focused", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const { container } = render(<Editor doc={doc} awareness={awareness} />);
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    });

    const find = container.querySelector("[data-testid='note-search-find']") as HTMLInputElement;
    find.focus();
    fireEvent.keyDown(find, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeNull();
    });
  });

  it("closes the open panel on a second window Ctrl+F / Cmd+F", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const { container } = render(<Editor doc={doc} awareness={awareness} />);
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeNull();
    });

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    });
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeNull();
    });
  });

  it("closes on a second Ctrl+F when the editor content is focused", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const { container } = render(<Editor doc={doc} awareness={awareness} />);
    const content = await waitFor(() => {
      const el = container.querySelector(".cm-content");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    content.focus();
    fireEvent.keyDown(content, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    });

    content.focus();
    fireEvent.keyDown(content, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeNull();
    });
  });

  it("does not close on Ctrl+H, and does not steal Ctrl+F from an unrelated INPUT while open", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const { container } = render(<Editor doc={doc} awareness={awareness} />);
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    expect(container.querySelector("[data-testid='note-search-panel']")).toHaveAttribute(
      "data-replace-open",
      "true",
    );

    fireEvent.keyDown(window, { key: "f", metaKey: true, altKey: true });
    expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    expect(container.querySelector("[data-testid='note-search-panel']")).toHaveAttribute(
      "data-replace-open",
      "true",
    );

    const foreign = document.createElement("input");
    document.body.append(foreign);
    fireEvent.keyDown(foreign, { key: "f", ctrlKey: true });
    expect(container.querySelector("[data-testid='note-search-panel']")).toBeTruthy();
    foreign.remove();
  });

  it("finds the next match with F3 after the panel is closed", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "alpha beta alpha");
    const awareness = new Awareness(doc);
    const { container } = render(<Editor doc={doc} awareness={awareness} />);
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const find = await waitFor(() => {
      const el = container.querySelector("[data-testid='note-search-find']") as HTMLInputElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.input(find, { target: { value: "alpha" } });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector("[data-testid='note-search-panel']")).toBeNull();
    });

    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
    expect(view).toBeTruthy();
    view!.dispatch({ selection: { anchor: 0 } });
    fireEvent.keyDown(window, { key: "F3" });
    expect(view!.state.selection.main.from).toBe(0);
    fireEvent.keyDown(window, { key: "F3" });
    expect(view!.state.selection.main.from).toBe(11);
  });
});
