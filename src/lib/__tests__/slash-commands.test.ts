import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import type { TKey } from "@/i18n";
import { renderMarkdown } from "@/lib/markdown/preview-worker-renderer";
import {
  slashCommands,
  slashCompletionSource,
  slashItems,
} from "../slash-commands";

function t(key: TKey): string {
  return `i18n:${key}`;
}

async function completeAt(doc: string, pos = doc.length): Promise<CompletionResult | null> {
  const state = EditorState.create({
    doc,
    extensions: slashCommands(),
  });
  return Promise.resolve(slashCompletionSource(new CompletionContext(state, pos, true)));
}

describe("slash command snippets", () => {
  it("offers mermaid, math, and the five GFM callouts from line-start /", async () => {
    const result = await completeAt("/");
    expect(result).not.toBeNull();
    const labels = result!.options.map((option) => option.label);
    expect(labels).toEqual(expect.arrayContaining([
      "/mermaid",
      "/math",
      "/note",
      "/tip",
      "/important",
      "/warning",
      "/caution",
    ]));
  });

  it("i18n's new item details instead of hardcoding Vietnamese column labels", () => {
    const items = slashItems(t);
    const mermaid = items.find((item) => item.label === "/mermaid");
    const math = items.find((item) => item.label === "/math");
    const note = items.find((item) => item.label === "/note");
    expect(mermaid?.detail).toBe("i18n:slash.detail.mermaid");
    expect(math?.detail).toBe("i18n:slash.detail.math");
    expect(note?.detail).toBe("i18n:slash.detail.note");
    expect(mermaid?.build().text).not.toMatch(/Cột/);
    expect(note?.build().text).not.toMatch(/Cột/);
  });

  it("inserts a mermaid fence the existing preview renderer understands, cursor inside", async () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({ doc: "/mermaid", extensions: slashCommands() }),
      parent,
    });
    const result = await Promise.resolve(
      slashCompletionSource(new CompletionContext(view.state, 8, true)),
    );
    const option = result?.options.find((item) => item.label === "/mermaid");
    expect(option).toBeTruthy();
    expect(typeof option!.apply).toBe("function");
    (option!.apply as (view: EditorView, completion: unknown, from: number, to: number) => void)(
      view,
      option,
      0,
      8,
    );
    const text = view.state.doc.toString();
    expect(text).toMatch(/^```mermaid\n/);
    expect(text).toContain("```");
    expect(renderMarkdown(text)).toContain("data-mermaid");
    const cursor = view.state.selection.main.head;
    expect(text.slice(0, cursor)).toMatch(/```mermaid\n$/);
    expect(text.slice(cursor)).toMatch(/^\n```/);
    view.destroy();
  });

  it("inserts a math fence the existing KaTeX renderer understands, cursor inside", () => {
    const { text, cursor } = slashItems(t).find((item) => item.label === "/math")!.build();
    expect(renderMarkdown(text)).toContain("data-katex");
    expect(text.slice(0, cursor ?? text.length)).toMatch(/```math\n$/);
  });

  it.each(["note", "tip", "important", "warning", "caution"] as const)(
    "inserts a valid GFM %s callout with the cursor in the body",
    (kind) => {
      const { text, cursor } = slashItems(t).find((item) => item.label === `/${kind}`)!.build();
      const html = renderMarkdown(text);
      expect(html).toContain(`data-md-alert="${kind}"`);
      const at = cursor ?? text.length;
      expect(text.slice(0, at)).toMatch(new RegExp(`> \\[!${kind.toUpperCase()}\\]\\n> $`));
    },
  );

  it("does not fire in the middle of a line", async () => {
    expect(await completeAt("see /table", 10)).toBeNull();
  });
});
