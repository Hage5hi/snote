/**
 * New-note markdown templates. Built-ins are i18n copy; custom templates live
 * in localStorage. Seeds are one-shot sessionStorage markdown, never
 * capability tokens and never recents/pins preview.
 */
import type { TKey } from "@/i18n";
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "@/lib/safe-storage";

export const BUILTIN_TEMPLATE_IDS = ["blank", "meeting", "daily"] as const;
export type BuiltinTemplateId = (typeof BUILTIN_TEMPLATE_IDS)[number];

export type CustomTemplate = {
  id: string;
  name: string;
  markdown: string;
};

export type SeedableText = {
  toString(): string;
  insert(index: number, text: string): void;
};

const CUSTOM_KEY = "note.templates";
const SEED_PREFIX = "note.template-seed:";
const MAX_CUSTOM = 20;
const MAX_NAME = 80;
const MAX_MARKDOWN = 8_000;

function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function resolveTemplateMarkdown(
  id: string,
  t: (key: TKey, vars?: Record<string, string | number>) => string,
  date = todayIso(),
): string {
  if (id === "blank") return "";
  if (id === "meeting") return t("home.templates.meeting.body", { date });
  if (id === "daily") return t("home.templates.daily.body", { date });
  const custom = getCustomTemplates().find((row) => row.id === id);
  return custom?.markdown ?? "";
}

export function getCustomTemplates(): CustomTemplate[] {
  try {
    const raw = safeLocalStorageGet(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCustomTemplate);
  } catch {
    return [];
  }
}

export function upsertCustomTemplate(input: {
  id?: string;
  name: string;
  markdown: string;
}): CustomTemplate | null {
  const name = input.name.trim().slice(0, MAX_NAME);
  const markdown = input.markdown.slice(0, MAX_MARKDOWN);
  if (!name || !markdown.trim()) return null;
  const list = getCustomTemplates();
  const next: CustomTemplate = {
    id: input.id && list.some((row) => row.id === input.id) ? input.id : newTemplateId(),
    name,
    markdown,
  };
  const idx = list.findIndex((row) => row.id === next.id);
  if (idx >= 0) {
    list[idx] = next;
  } else {
    if (list.length >= MAX_CUSTOM) return null;
    list.push(next);
  }
  persistCustom(list);
  return next;
}

export function deleteCustomTemplate(id: string): CustomTemplate[] {
  const next = getCustomTemplates().filter((row) => row.id !== id);
  persistCustom(next);
  return next;
}

export function queueTemplateSeed(slug: string, markdown: string): void {
  if (!slug || !markdown) return;
  try {
    sessionStorage.setItem(`${SEED_PREFIX}${slug}`, markdown.slice(0, MAX_MARKDOWN));
  } catch {
    /* private mode / quota */
  }
}

export function consumeTemplateSeed(slug: string): string | null {
  const key = `${SEED_PREFIX}${slug}`;
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return raw;
  } catch {
    return null;
  }
}

export function applyTemplateSeedIfEmpty(ytext: SeedableText, slug: string): boolean {
  if (ytext.toString().length > 0) {
    consumeTemplateSeed(slug);
    return false;
  }
  const seed = consumeTemplateSeed(slug);
  if (!seed) return false;
  ytext.insert(0, seed);
  return true;
}

function persistCustom(list: CustomTemplate[]) {
  safeLocalStorageSet(
    CUSTOM_KEY,
    JSON.stringify(list.map((row) => ({ id: row.id, name: row.name, markdown: row.markdown }))),
  );
}

function isCustomTemplate(value: unknown): value is CustomTemplate {
  if (!value || typeof value !== "object") return false;
  const row = value as CustomTemplate;
  return typeof row.id === "string"
    && typeof row.name === "string"
    && typeof row.markdown === "string";
}

function newTemplateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
