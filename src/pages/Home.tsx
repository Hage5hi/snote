import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Loader2, Shuffle, Sparkles, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { getPinned, getRecents, removeRecent, togglePin, type RecentNote } from "@/lib/recent-notes";
import { InstallPrompt } from "@/components/note/InstallPrompt";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";

// Cross-fade navigation when the browser supports the View Transitions API.
function softNavigate(navigate: (path: string) => void, path: string) {
  const w = document as unknown as {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (w.startViewTransition) {
    w.startViewTransition(() => navigate(path));
  } else {
    navigate(path);
  }
}

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
type SlugStatus = "idle" | "checking" | "available" | "taken" | "invalid";

function randomSlug() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function useTimeAgo() {
  const { t } = useI18n();
  return (ts: number) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return t("time.just_now");
    if (m < 60) return t("time.minutes_ago", { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("time.hours_ago", { n: h });
    const d = Math.floor(h / 24);
    return t("time.days_ago", { n: d });
  };
}

// Idle prefetch helper.
function onIdle(cb: () => void) {
  if (typeof window === "undefined") return;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (ric) ric(cb);
  else window.setTimeout(cb, 200);
}

export default function Home() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const timeAgo = useTimeAgo();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentNote[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");

  useEffect(() => {
    setRecents(getRecents());
    setPinned(getPinned());
  }, []);

  // Stay in sync with pins toggled elsewhere (NotePage's PinButton, Cmd+K).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "note.pinned") setPinned(getPinned());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Debounced availability check.
  useEffect(() => {
    const trimmed = slug.trim();
    if (!trimmed) {
      setSlugStatus("idle");
      return;
    }
    if (!SLUG_RE.test(trimmed)) {
      setSlugStatus("invalid");
      return;
    }
    setSlugStatus("checking");
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("slug, char_count")
        .eq("slug", trimmed)
        .abortSignal(ctrl.signal)
        .maybeSingle();
      if (ctrl.signal.aborted) return;
      if (error) {
        setSlugStatus("idle");
        return;
      }
      // Treat empty notes as still available — common case is auto-created
      // from a typo or prefetch path.
      if (!data || (data.char_count ?? 0) === 0) setSlugStatus("available");
      else setSlugStatus("taken");
    }, 350);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [slug]);

  // Warm up heavy editor modules so opening a note feels instant.
  useEffect(() => {
    onIdle(() => {
      void import("@/pages/NotePage");
      void import("yjs");
      void import("y-indexeddb");
      void import("y-codemirror.next");
      void import("@codemirror/lang-markdown");
      void import("marked");
      void import("dompurify");
    });
  }, []);

  const open = (s: string) => {
    const trimmed = s.trim();
    if (!SLUG_RE.test(trimmed)) {
      setError(t("home.error.invalid_slug"));
      return;
    }
    softNavigate(navigate, `/${trimmed}`);
  };

  // Prefetch a note's full opening payload on hover. We grab enc-meta AND the
  // ydoc snapshot in one query so the eventual NotePage mount has zero
  // network waterfall.
  const prefetchSnapshot = (s: string) => {
    const key = `note-prefetch:${s}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void supabase
      .from("notes")
      .select("ydoc_state, is_encrypted, enc_salt, enc_check")
      .eq("slug", s)
      .maybeSingle()
      .then(({ data }) => {
        // Only stash the snapshot for plaintext notes — encrypted bytes need
        // the key to be useful and would just take cache space.
        if (data?.ydoc_state && !data?.is_encrypted) {
          try {
            sessionStorage.setItem(`note-snapshot:${s}`, data.ydoc_state);
          } catch {
            // QuotaExceeded — silently drop, network fetch is still fast.
          }
        }
      });
  };

  return (
    <div className="min-h-svh bg-background">
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Syrin Notes logo" className="h-6 w-6 rounded-md object-contain" />
          <span className="font-semibold tracking-tight">Syrin Notes</span>
        </div>
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          {t("home.tagline")}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {t("home.intro_prefix")}
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm">/hello</code>
          {t("home.intro_suffix")}
        </p>

        <form
          className="mt-8 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            open(slug);
          }}
        >
          <div className="flex flex-1 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <span className="pl-3 text-sm text-muted-foreground select-none">/</span>
            <Input
              autoFocus
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setError(null);
              }}
              placeholder={t("home.placeholder")}
              className="border-0 focus-visible:ring-0 font-mono"
              maxLength={64}
            />
            <div className="shrink-0 whitespace-nowrap pr-2 text-muted-foreground">
              {slugStatus === "checking" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {slugStatus === "available" && (
                <Check className="h-3.5 w-3.5 text-success" aria-label={t("home.status.available")} />
              )}
              {slugStatus === "taken" && (
                <span className="text-[10px] font-medium text-warning">{t("home.status.taken")}</span>
              )}
              {slugStatus === "invalid" && (
                <span className="text-[10px] font-medium text-destructive">{t("home.status.invalid")}</span>
              )}
            </div>
          </div>
          <Button type="submit" disabled={!slug.trim()}>
            {slugStatus === "taken" ? t("home.btn.open_existing") : t("home.btn.open")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => softNavigate(navigate, `/${randomSlug()}`)}
          >
            <Shuffle className="h-3.5 w-3.5" />
            {t("home.btn.random")}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {t("home.cmdk_hint_prefix")}<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>{t("home.cmdk_hint_suffix")}
          </span>
        </div>

        <InstallPrompt />

        {pinned.length > 0 && (
          <section
            className="sticky top-0 z-10 mt-10 -mx-4 bg-background/95 px-4 pb-3 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
            aria-label={t("home.pinned.aria")}
          >
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Star className="h-3 w-3 fill-primary text-primary" />
              {t("home.pinned.title")}
            </h2>
            <ul className="flex flex-wrap gap-1.5">
              {pinned.map((s) => (
                <li key={s} className="group flex items-stretch overflow-hidden rounded-md border border-border bg-background">
                  <button
                    className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-sm hover:bg-accent"
                    onClick={() => softNavigate(navigate, `/${s}`)}
                    onMouseEnter={() => prefetchSnapshot(s)}
                    onTouchStart={() => prefetchSnapshot(s)}
                  >
                    <Star className="h-3 w-3 fill-primary text-primary" />
                    /{s}
                  </button>
                  <button
                    aria-label={t("home.pinned.unpin")}
                    title={t("home.pinned.unpin")}
                    onClick={() => setPinned(togglePin(s))}
                    className="flex items-center px-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recents.length > 0 ? (
          <section className="mt-12">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("home.recent.title")}
            </h2>
            <ul className="divide-y divide-border rounded-md border border-border">
              {recents.slice(0, 12).map((r) => (
                <li
                  key={r.slug}
                  className="group flex items-center gap-2 px-3 py-2 hover:bg-accent/50"
                  onMouseEnter={() => prefetchSnapshot(r.slug)}
                  onTouchStart={() => prefetchSnapshot(r.slug)}
                >
                  <button
                    className="flex flex-1 items-center justify-between text-left"
                    onClick={() => softNavigate(navigate, `/${r.slug}`)}
                  >
                    <span className="font-mono text-sm">/{r.slug}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(r.lastOpenedAt)}</span>
                  </button>
                  <button
                    aria-label={t("home.recent.remove")}
                    onClick={() => setRecents(removeRecent(r.slug))}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("home.recent.local_only")}
            </p>
          </section>
        ) : (
          <section className="mt-12 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-background ring-1 ring-border">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">{t("home.empty.title")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("home.empty.hint")}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {["scratch", "todo", "ideas", "journal"].map((s) => (
                <button
                  key={s}
                  onClick={() => softNavigate(navigate, `/${s}`)}
                  onMouseEnter={() => prefetchSnapshot(s)}
                  className="rounded-md border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground hover:bg-accent"
                >
                  /{s}
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
