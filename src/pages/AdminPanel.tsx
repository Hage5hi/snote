import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Trash2, Search, RefreshCw, Sparkles, X, KeyRound } from "lucide-react";
import { RotatePassDialog } from "@/components/admin/RotatePassDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import NotFound from "./NotFound";

type AdminNote = {
  slug: string;
  char_count: number;
  is_encrypted: boolean;
  updated_at: string;
  created_at: string;
  preview: string;
  tags: string[];
};

type TopTag = { name: string; count: number };

// Neutral key — avoid hinting at "admin" in DevTools storage panel.
const SESSION_KEY = "__a";

type GateStatus = "checking" | "denied" | "allowed";

export default function AdminPanel() {
  const [gate, setGate] = useState<GateStatus>("checking");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdminNote[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [topTags, setTopTags] = useState<TopTag[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState<null | "selected" | "all">(null);
  const [rotateOpen, setRotateOpen] = useState(false);

  const initialTagRef = useRef<string>("");

  // Inject <meta name="robots" content="noindex,nofollow"> while this route is mounted.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow,noarchive";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  // Gate: only render the panel when `/note#<correct-pass>` was used,
  // OR when a sessionStorage key from a prior successful verify exists.
  // Otherwise render NotFound (indistinguishable from a real 404).
  useEffect(() => {
    let cancelled = false;

    const rawHash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";

    // Allow `#tag=foo&...` to coexist if cached session is present.
    let hashKey = "";
    let hashTag = "";
    if (rawHash) {
      // If the hash *looks* like URL params (contains `=`), parse as params.
      // Otherwise treat the entire hash as the passphrase.
      if (rawHash.includes("=")) {
        const params = new URLSearchParams(rawHash);
        hashKey = params.get("k") ?? "";
        hashTag = params.get("tag")?.toLowerCase() ?? "";
      } else {
        hashKey = rawHash;
      }
    }

    const cached = sessionStorage.getItem(SESSION_KEY) ?? "";
    const candidate = hashKey || cached;
    initialTagRef.current = hashTag;

    // SECURITY: scrub the hash from the URL *synchronously* before any async
    // network call so the passphrase never lingers in window.location during
    // the await. This protects against extensions, screen recording, and
    // referrer leakage that could capture the hash mid-verification.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    (async () => {
      // Always make a verify request — even with empty key — so timing
      // looks the same to an outside observer.
      try {
        const { data, error } = await supabase.functions.invoke("admin-list", {
          body: { passphrase: candidate, limit: 1, offset: 0 },
        });
        if (cancelled) return;
        if (error || data?.error) {
          // Wrong/empty key. Drop any stale session and pretend 404.
          sessionStorage.removeItem(SESSION_KEY);
          setGate("denied");
          return;
        }
        // Verified. Persist (hash already scrubbed synchronously above).
        sessionStorage.setItem(SESSION_KEY, candidate);
        setPass(candidate);
        if (hashTag) setTagFilter(hashTag);
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setTopTags(data.topTags ?? []);
        setGate("allowed");
        // Kick off a full fetch (limit 200) in background so the list is complete.
        void fetchList(candidate, "", hashTag);
      } catch {
        if (cancelled) return;
        sessionStorage.removeItem(SESSION_KEY);
        setGate("denied");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchList = async (passToUse: string, q = "", tag = "") => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-list", {
        body: { passphrase: passToUse, search: q, tag, limit: 200, offset: 0 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setTopTags(data.topTags ?? []);
      setSelected(new Set());
      return true;
    } catch (e) {
      const msg = String((e as Error | undefined)?.message ?? e);
      toast({
        title: "Failed to load list",
        description: msg.includes("unauthorized") ? "Wrong admin key." : msg,
        variant: "destructive",
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetchList(pass, search, tagFilter);
  };

  const applyTag = async (tag: string) => {
    const next = tagFilter === tag ? "" : tag;
    setTagFilter(next);
    await fetchList(pass, search, next);
  };

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.slug)));
  };
  const toggle = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setSelected(next);
  };

  const doDelete = async (mode: "selected" | "all") => {
    setLoading(true);
    try {
      const body: { passphrase: string; all?: boolean; slugs?: string[] } = { passphrase: pass };
      if (mode === "all") body.all = true;
      else body.slugs = Array.from(selected);
      const { data, error } = await supabase.functions.invoke("admin-delete", {
        body,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: `Deleted ${data.deleted} note(s)` });
      await fetchList(pass, search, tagFilter);
    } catch (e) {
      toast({
        title: "Delete failed",
        description: String((e as Error | undefined)?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setConfirmOpen(null);
    }
  };

  const runCleanup = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleanup", {
        body: { passphrase: pass, olderThanHours: 1 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: `Cleaned ${data.deleted} empty note(s)` });
      await fetchList(pass, search, tagFilter);
    } catch (e) {
      toast({ title: "Cleanup error", description: String((e as Error | undefined)?.message ?? e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setGate("denied");
    setPass("");
    setItems([]);
  };

  // While verifying OR if denied: render the NotFound page exactly.
  // This makes /note indistinguishable from any random invalid path.
  if (gate !== "allowed") {
    return <NotFound />;
  }

  return (
    <div className="min-h-svh bg-background">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-semibold">Admin · {total} note</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={runCleanup} disabled={loading}>
            <Sparkles className="h-3.5 w-3.5" />
            Clean empty notes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRotateOpen(true)} disabled={loading}>
            <KeyRound className="h-3.5 w-3.5" />
            Rotate key
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fetchList(pass, search, tagFilter)} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={logout}>
            Logout
          </Button>
        </div>
      </header>

      <RotatePassDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        currentPass={pass}
        onSuccess={(newPass) => {
          sessionStorage.setItem(SESSION_KEY, newPass);
          setPass(newPass);
        }}
      />

      <div className="mx-auto max-w-5xl p-4">
        <form onSubmit={onSearch} className="mb-3 flex gap-2">
          <div className="flex flex-1 items-center rounded-md border border-input bg-background px-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by slug or content…"
              className="border-0 focus-visible:ring-0"
            />
          </div>
          <Button type="submit" variant="outline" disabled={loading}>
            Search
          </Button>
        </form>

        {(topTags.length > 0 || tagFilter) && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Tags:</span>
            {tagFilter && (
              <button
                onClick={() => applyTag(tagFilter)}
                className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background"
              >
                #{tagFilter}
                <X className="h-3 w-3" />
              </button>
            )}
            {topTags
              .filter((t) => t.name !== tagFilter)
              .map((t) => (
                <button
                  key={t.name}
                  onClick={() => applyTag(t.name)}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground hover:text-foreground"
                >
                  #{t.name}
                  <span className="ml-1 opacity-60">{t.count}</span>
                </button>
              ))}
          </div>
        )}

        <div className="mb-2 flex items-center gap-2 text-xs">
          <Checkbox
            checked={items.length > 0 && selected.size === items.length}
            onCheckedChange={toggleAll}
          />
          <span className="text-muted-foreground">
            {selected.size} selected / {items.length} shown
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={selected.size === 0 || loading}
              onClick={() => setConfirmOpen("selected")}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || items.length === 0}
              onClick={() => setConfirmOpen("all")}
            >
              Delete ALL
            </Button>
          </div>
        </div>

        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((n) => (
            <li key={n.slug} className="flex items-start gap-3 px-3 py-2 hover:bg-accent/40">
              <Checkbox
                checked={selected.has(n.slug)}
                onCheckedChange={() => toggle(n.slug)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/${n.slug}`}
                    target="_blank"
                    className="font-mono text-sm hover:underline"
                  >
                    /{n.slug}
                  </Link>
                  {n.is_encrypted && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">🔒</span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {n.char_count} chars · {new Date(n.updated_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {n.preview || "(empty)"}
                </p>
                {n.tags && n.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {n.tags.slice(0, 8).map((t) => (
                      <button
                        key={t}
                        onClick={() => applyTag(t)}
                        className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
          {items.length === 0 && !loading && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No notes.
            </li>
          )}
        </ul>
      </div>

      <AlertDialog open={confirmOpen !== null} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmOpen === "all" ? "Delete ALL notes?" : `Delete ${selected.size} note(s)?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Content will be permanently deleted from the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmOpen && doDelete(confirmOpen)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
