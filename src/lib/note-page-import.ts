import { importWithTimeoutRetry } from "@/lib/import-with-timeout";

function envNum(key: string, fallback: number): number {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const NOTE_PAGE_IMPORT_TIMEOUT_MS = envNum("VITE_PWA_NOTEPAGE_IMPORT_TIMEOUT_MS", 5000);

export function loadNotePage() {
  return importWithTimeoutRetry(() => import("@/pages/NotePage"), {
    timeoutMs: NOTE_PAGE_IMPORT_TIMEOUT_MS,
    onGiveUp: () => {
      void import("@/lib/pwa-update").then((mod) => {
        mod.recoverMaroonedPwaUpdateOnce("lazy-import");
      });
    },
  });
}
