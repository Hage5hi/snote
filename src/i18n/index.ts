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
    "home.pinned.title": "Ghim",
    "home.pinned.unpin": "Bỏ ghim",
    "home.pinned.aria": "Note đã ghim",

    "home.empty.title": "Chưa có note nào",
    "home.empty.hint": "Thử mở một slug có sẵn để bắt đầu:",
    "time.just_now": "vừa xong",
    "time.minutes_ago": "{n} phút trước",
    "time.hours_ago": "{n} giờ trước",
    "time.days_ago": "{n} ngày trước",
    "lang.toggle": "English",
    "lang.label": "Ngôn ngữ",

    "sync.label.synced": "Đã đồng bộ",
    "sync.label.syncing": "Đang đồng bộ…",
    "sync.label.conflict": "Đã hợp nhất",
    "sync.label.error": "Lỗi đồng bộ",
    "sync.label.offline": "Mất kết nối",
    "sync.tooltip.synced_at": "Đã lưu {when}",
    "sync.tooltip.syncing": "{bytes} byte đang gửi",
    "sync.tooltip.conflict": "Đã hợp nhất thay đổi từ thiết bị khác",
    "sync.tooltip.offline": "Mất kết nối — thay đổi sẽ gửi khi online",
    "sync.detail.pending": "Chờ gửi",
    "sync.detail.last_broadcast": "Broadcast",
    "sync.detail.last_snapshot": "Snapshot",
    "sync.detail.never": "chưa có",
    "sync.detail.error_label": "Lỗi gần nhất",
    "sync.detail.conflict_hint": "Đã hợp nhất an toàn thay đổi từ thiết bị khác.",
    "sync.action.dismiss": "Bỏ qua",
    "sync.time.just_now": "vừa xong",
    "sync.time.s_ago": "{n}s trước",
    "sync.time.m_ago": "{n}m trước",
    "sync.time.h_ago": "{n}h trước",
    "sync.toast.recovered_title": "Đã đồng bộ từ thiết bị khác",
    "sync.toast.recovered_desc": "Hợp nhất {bytes} byte mới từ cloud.",
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
    "home.pinned.title": "Pinned",
    "home.pinned.unpin": "Unpin",
    "home.pinned.aria": "Pinned notes",

    "home.empty.title": "No notes yet",
    "home.empty.hint": "Try opening one of these to get started:",
    "time.just_now": "just now",
    "time.minutes_ago": "{n} min ago",
    "time.hours_ago": "{n} h ago",
    "time.days_ago": "{n} d ago",
    "lang.toggle": "Tiếng Việt",
    "lang.label": "Language",

    "sync.label.synced": "Synced",
    "sync.label.syncing": "Syncing…",
    "sync.label.conflict": "Merged",
    "sync.label.error": "Sync error",
    "sync.label.offline": "Offline",
    "sync.tooltip.synced_at": "Saved {when}",
    "sync.tooltip.syncing": "{bytes} bytes pending",
    "sync.tooltip.conflict": "Merged changes from another device",
    "sync.tooltip.offline": "Offline — edits will sync when reconnected",
    "sync.detail.pending": "Pending",
    "sync.detail.last_broadcast": "Broadcast",
    "sync.detail.last_snapshot": "Snapshot",
    "sync.detail.never": "never",
    "sync.detail.error_label": "Last error",
    "sync.detail.conflict_hint": "Safely merged changes from another device.",
    "sync.action.dismiss": "Dismiss",
    "sync.time.just_now": "just now",
    "sync.time.s_ago": "{n}s ago",
    "sync.time.m_ago": "{n}m ago",
    "sync.time.h_ago": "{n}h ago",
    "sync.toast.recovered_title": "Synced from another device",
    "sync.toast.recovered_desc": "Merged {bytes} new bytes from cloud.",
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
