// PWA update flow.
//
// Why this exists: previously vite-plugin-pwa was configured with
// `registerType: "autoUpdate"` + `injectRegister: "auto"`. That silently
// installs the new SW, claims clients, then leaves the open tab running the
// old in-memory JS. To actually pick up new code, users had to clear cookies /
// site-data — which wipes localStorage too, blowing away `note.recents`
// (the 50 most-recently-opened slugs) and `note.pinned`. Note content itself
// is safe on Supabase, but users couldn't remember slugs, so it felt like
// data loss.
//
// New flow:
//   1. Vite is now `registerType: "prompt"` + `injectRegister: false`.
//   2. We register the SW here and listen for `onNeedRefresh`.
//   3. When a new version is detected, we show a persistent Sonner toast with
//      an explicit "Update" button. The user keeps full control — no auto
//      reload, no data wipe.
//   4. We also poll `registration.update()` hourly so long-running PWA tabs
//      (standalone install) eventually notice updates, plus we re-check
//      whenever the tab regains focus / visibility so the preview iframe
//      doesn't sit on a stale build.

import { registerSW } from "virtual:pwa-register";
import { toast as sonnerToast } from "sonner";
import { detectLang, dict, STORAGE_KEY, type Lang } from "@/i18n";

// Re-check for a new SW every hour. Short enough that a user who leaves the
// PWA open all day still picks updates up the same session; long enough not
// to thrash on flaky networks.
const UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1000;

const TOAST_ID = "pwa-update-toast";

type FlatDict = Record<string, string>;

function tr(lang: Lang, key: string): string {
  const d = dict as unknown as Record<Lang, FlatDict>;
  return d[lang]?.[key] ?? d.en[key] ?? key;
}

export function registerAppUpdater(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // No SW is generated in dev builds (devOptions.enabled: false), so skip.
  if (import.meta.env.DEV) return;

  let updateAvailable = false;

  const showToast = (updateSW: (reload?: boolean) => Promise<void>) => {
    // Read language fresh each time so the toast matches the user's
    // *current* selection, not whatever was set when the SW registered.
    const lang = detectLang();
    sonnerToast(tr(lang, "update.title"), {
      id: TOAST_ID,
      description: tr(lang, "update.description"),
      // Stay visible until the user decides. Sonner treats Infinity as
      // "never auto-dismiss".
      duration: Infinity,
      action: {
        label: tr(lang, "update.btn_reload"),
        onClick: () => {
          // updateSW(true) posts SKIP_WAITING to the waiting SW and reloads
          // the page once the new SW takes control. No data is cleared —
          // IndexedDB (Yjs), localStorage (recents/pins/theme), and any
          // Supabase session all survive the reload.
          void updateSW(true);
        },
      },
    });
  };

  const updateSW = registerSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Check immediately so a freshly opened preview tab that's been left
      // open across deploys doesn't have to wait an hour to notice.
      registration.update().catch(() => {});
      window.setInterval(() => {
        // Silent: any network failure here is fine, we'll try again next tick.
        registration.update().catch(() => {});
      }, UPDATE_POLL_INTERVAL_MS);
      // Re-check whenever the tab becomes visible again (catches the
      // "preview iframe was hidden during deploy" case).
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      });
    },
    onNeedRefresh() {
      updateAvailable = true;
      showToast(updateSW);
    },
  });

  // If the user switches language while the update toast is visible, re-show
  // it with the new translations.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && updateAvailable) {
      showToast(updateSW);
    }
  });
  // Same-tab language changes don't fire `storage`; provider dispatches this
  // custom event so we can refresh the toast in place.
  window.addEventListener("i18n:lang-changed", () => {
    if (updateAvailable) showToast(updateSW);
  });
}
