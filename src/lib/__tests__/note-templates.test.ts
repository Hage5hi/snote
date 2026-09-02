import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TKey } from "@/i18n";
import {
  applyTemplateSeedIfEmpty,
  consumeTemplateSeed,
  deleteCustomTemplate,
  getCustomTemplates,
  queueTemplateSeed,
  resolveTemplateMarkdown,
  upsertCustomTemplate,
} from "../note-templates";

function t(key: TKey, vars?: Record<string, string | number>) {
  if (key === "home.templates.meeting.body") return `# Meeting — ${vars?.date ?? "{date}"}\n`;
  if (key === "home.templates.daily.body") return `# ${vars?.date ?? "{date}"}\n`;
  return key;
}

describe("note templates", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("resolves built-in markdown without capability fragments or hashes", () => {
    const meeting = resolveTemplateMarkdown("meeting", t, "2026-09-02");
    const daily = resolveTemplateMarkdown("daily", t, "2026-09-02");
    expect(resolveTemplateMarkdown("blank", t)).toBe("");
    expect(meeting).toBe("# Meeting — 2026-09-02\n");
    expect(daily).toBe("# 2026-09-02\n");
    expect(`${meeting}${daily}`).not.toMatch(/#(?:owner|edit|view)=/);
  });

  it("persists user-custom templates in localStorage as name+markdown only", () => {
    const saved = upsertCustomTemplate({ name: " Standup ", markdown: "## Standup\n- " });
    expect(saved).toMatchObject({ name: "Standup", markdown: "## Standup\n- " });
    expect(getCustomTemplates()).toEqual([saved]);
    expect(JSON.parse(localStorage.getItem("note.templates") ?? "[]")).toEqual([saved]);
    expect(Object.keys(saved!).sort()).toEqual(["id", "markdown", "name"]);

    expect(deleteCustomTemplate(saved!.id)).toEqual([]);
    expect(getCustomTemplates()).toEqual([]);
  });

  it("queues a one-shot seed in sessionStorage and does not write recents/pins", () => {
    queueTemplateSeed("daily", "# Meeting\n");
    expect(localStorage.getItem("note.recents")).toBeNull();
    expect(localStorage.getItem("note.pinned")).toBeNull();
    expect(consumeTemplateSeed("daily")).toBe("# Meeting\n");
    expect(consumeTemplateSeed("daily")).toBeNull();
  });

  it("seeds empty ytext and refuses to overwrite existing content", () => {
    queueTemplateSeed("daily", "# Meeting\n");
    const empty = { value: "", toString() { return this.value; }, insert(_i: number, text: string) { this.value += text; } };
    expect(applyTemplateSeedIfEmpty(empty, "daily")).toBe(true);
    expect(empty.toString()).toBe("# Meeting\n");

    queueTemplateSeed("daily", "# Other\n");
    const existing = { value: "already here", toString() { return this.value; }, insert() { throw new Error("must not insert"); } };
    expect(applyTemplateSeedIfEmpty(existing, "daily")).toBe(false);
    expect(existing.toString()).toBe("already here");
    expect(consumeTemplateSeed("daily")).toBeNull();
  });

  it("does not queue a blank template seed", () => {
    queueTemplateSeed("daily", "");
    expect(consumeTemplateSeed("daily")).toBeNull();
  });
});
