import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText, Shuffle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getRecents, removeRecent, type RecentNote } from "@/lib/recent-notes";
import { InstallPrompt } from "@/components/note/InstallPrompt";
import { supabase } from "@/integrations/supabase/client";

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function randomSlug() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  return `${d} ngày trước`;
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
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentNote[]>([]);

  useEffect(() => setRecents(getRecents()), []);

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
      setError("Tên note chỉ chứa chữ, số, dấu - hoặc _ (tối đa 64 ký tự)");
      return;
    }
    navigate(`/${trimmed}`);
  };

  // Prefetch a note's snapshot on hover, stash in sessionStorage as a hint.
  const prefetchSnapshot = (s: string) => {
    const key = `note-prefetch:${s}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void supabase
      .from("notes")
      .select("ydoc_state")
      .eq("slug", s)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.ydoc_state) {
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
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <span className="font-semibold tracking-tight">Notes</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-xl px-4 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Note online, đồng bộ tức thì.
        </h1>
        <p className="mt-3 text-muted-foreground">
          Mở bất kỳ note nào bằng URL — ví dụ <code className="rounded bg-muted px-1.5 py-0.5 text-sm">/{`hello`}</code>. Tự động lưu, đồng bộ realtime giữa các thiết bị, hoạt động cả khi offline.
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
              placeholder="my-note"
              className="border-0 focus-visible:ring-0 font-mono"
              maxLength={64}
            />
          </div>
          <Button type="submit" disabled={!slug.trim()}>
            Mở <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/${randomSlug()}`)}
          >
            <Shuffle className="h-3.5 w-3.5" />
            Note ngẫu nhiên
          </Button>
        </div>

        <InstallPrompt />

        {recents.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Note gần đây
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
                    onClick={() => navigate(`/${r.slug}`)}
                  >
                    <span className="font-mono text-sm">/{r.slug}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(r.lastOpenedAt)}</span>
                  </button>
                  <button
                    aria-label="Xoá khỏi danh sách"
                    onClick={() => setRecents(removeRecent(r.slug))}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Danh sách này chỉ lưu trên thiết bị của bạn.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
