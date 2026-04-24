// Lightweight i18n: auto-detects Vietnamese (navigator.language starts with "vi")
// and falls back to English everywhere else. Choice is persisted in localStorage.
import { createContext, useContext } from "react";

export type Lang = "vi" | "en";

export const STORAGE_KEY = "lang";

export function detectLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "vi" || saved === "en") return saved;
  } catch {
    // ignore
  }
  const navLangs = (navigator.languages && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language || "en"]) as string[];
  for (const l of navLangs) {
    if (l && l.toLowerCase().startsWith("vi")) return "vi";
  }
  return "en";
}

// Translation dictionary. Keep keys flat and stable.
export const dict = {
  vi: {
    "home.tagline": "Note online, đồng bộ tức thì.",
    "home.intro_prefix": "Mở bất kỳ note nào bằng URL — ví dụ ",
    "home.intro_suffix":
      ". Tự động lưu, đồng bộ realtime giữa các thiết bị, hoạt động cả khi offline.",
    "home.placeholder": "ten-note-cua-toi",
    "home.status.checking": "Đang kiểm tra…",
    "home.status.available": "Slug trống",
    "home.status.taken": "Đã có note",
    "home.status.invalid": "Sai định dạng",
    "home.btn.open": "Mở",
    "home.btn.open_existing": "Mở note có sẵn",
    "home.btn.random": "Note ngẫu nhiên",
    "home.cmdk_hint_prefix": "hoặc nhấn ",
    "home.cmdk_hint_suffix": " để mở bảng lệnh",
    "home.error.invalid_slug": "Tên note chỉ chứa chữ, số, dấu - hoặc _ (tối đa 64 ký tự)",
    "home.recent.title": "Note gần đây",
    "home.recent.local_only": "Danh sách này chỉ lưu trên thiết bị của bạn.",
    "home.recent.remove": "Xoá khỏi danh sách",
    "home.empty.title": "Chưa có note nào",
    "home.empty.hint": "Thử mở một slug có sẵn để bắt đầu:",
    "time.just_now": "vừa xong",
    "time.minutes_ago": "{n} phút trước",
    "time.hours_ago": "{n} giờ trước",
    "time.days_ago": "{n} ngày trước",
    "lang.toggle": "English",
    "lang.label": "Ngôn ngữ",
  },
  en: {
    "home.tagline": "Online notes, synced instantly.",
    "home.intro_prefix": "Open any note by URL — e.g. ",
    "home.intro_suffix":
      ". Autosaves, syncs in realtime across devices, and works offline.",
    "home.placeholder": "my-note",
    "home.status.checking": "Checking…",
    "home.status.available": "Slug available",
    "home.status.taken": "Already exists",
    "home.status.invalid": "Invalid format",
    "home.btn.open": "Open",
    "home.btn.open_existing": "Open existing note",
    "home.btn.random": "Random note",
    "home.cmdk_hint_prefix": "or press ",
    "home.cmdk_hint_suffix": " to open the command palette",
    "home.error.invalid_slug":
      "Slug may only contain letters, digits, '-' or '_' (max 64 chars)",
    "home.recent.title": "Recent notes",
    "home.recent.local_only": "This list is only stored on your device.",
    "home.recent.remove": "Remove from list",
    "home.empty.title": "No notes yet",
    "home.empty.hint": "Try opening one of these to get started:",
    "time.just_now": "just now",
    "time.minutes_ago": "{n} min ago",
    "time.hours_ago": "{n} h ago",
    "time.days_ago": "{n} d ago",
    "lang.toggle": "Tiếng Việt",
    "lang.label": "Language",
  },
} as const;

export type TKey = keyof (typeof dict)["en"];

export interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

export const Ctx = createContext<I18nCtx | null>(null);

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
