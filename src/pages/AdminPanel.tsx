import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Trash2, Search, RefreshCw, Sparkles, X, KeyRound } from "lucide-react";
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
type GateStatus = "checking" | "denied" | "allowed";

// This stores a random, short-lived server session only. It never contains the
// admin passphrase supplied through the scrubbed URL fragment.
const SESSION_TOKEN_KEY = "__a_session";

function sessionHeaders(sessionToken: string): Record<string, string> {
  return { "x-admin-session": sessionToken };
}

export default function AdminPanel() {
  const [gate, setGate] = useState<GateStatus>("checking");
  const [sessionToken, setSessionToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdminNote[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [topTags, setTopTags] = useState<TopTag[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState<null | "selected" | "all">(null);
  const [rotateOpen, setRotateOpen] = useState(false);

  const fetchList = useCallback(
    async (token: string, query = "", tag = "") => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("admin-list", {
          body: { search: query, tag, limit: 200, offset: 0 },
          headers: sessionHeaders(token),
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setTopTags(data.topTags ?? []);
        setSelected(new Set());
        return true;
      } catch (error) {
        const message = String((error as Error | undefined)?.message ?? error);
        toast({
          title: "Failed to load list",
          description: message.includes("unauthorized") ? "Session expired." : message,
          variant: "destructive",
        });
        return false;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow,noarchive";
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const rawHash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    let fragmentPassphrase = "";
    let fragmentTag = "";
    if (rawHash.includes("=")) {
      const params = new URLSearchParams(rawHash);
      fragmentPassphrase = params.get("k") ?? "";
      fragmentTag = params.get("tag")?.toLowerCase() ?? "";
    } else {
      fragmentPassphrase = rawHash;
    }

    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    void (async () => {
      try {
        let opaqueToken = sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
        if (fragmentPassphrase) {
          const { data, error } = await supabase.functions.invoke("admin-session", {
            body: { passphrase: fragmentPassphrase },
          });
          fragmentPassphrase = "";
          if (error || !data?.sessionToken) throw error ?? new Error("unauthorized");
          opaqueToken = String(data.sessionToken);
        }
        if (!opaqueToken) throw new Error("unauthorized");

        const { data, error } = await supabase.functions.invoke("admin-list", {
          body: { limit: 1, offset: 0, tag: fragmentTag },
          headers: sessionHeaders(opaqueToken),
        });
        if (cancelled) return;
        if (error || data?.error) throw error ?? new Error(String(data?.error));

        sessionStorage.setItem(SESSION_TOKEN_KEY, opaqueToken);
        setSessionToken(opaqueToken);
        if (fragmentTag) setTagFilter(fragmentTag);
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setTopTags(data.topTags ?? []);
        setGate("allowed");
        void fetchList(opaqueToken, "", fragmentTag);
      } catch {
        fragmentPassphrase = "";
        if (cancelled) return;
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        setGate("denied");
      }
    })();

    return () => {
      cancelled = true;
      fragmentPassphrase = "";
    };
  }, [fetchList]);

  const onSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    await fetchList(sessionToken, search, tagFilter);
  };

  const applyTag = async (tag: string) => {
    const next = tagFilter === tag ? "" : tag;
    setTagFilter(next);
    await fetchList(sessionToken, search, next);
  };

  const toggleAll = () => {
    setSelected(
      selected.size === items.length
        ? new Set()
        : new Set(items.map((item) => item.slug)),
    );
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
      const body = mode === "all" ? { all: true } : { slugs: Array.from(selected) };
      const { data, error } = await supabase.functions.invoke("admin-delete", {
        body,
        headers: sessionHeaders(sessionToken),
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: `Deleted ${data.deleted} note(s)` });
      await fetchList(sessionToken, search, tagFilter);
    } catch (error) {
      toast({
        title: "Delete failed",
        description: String((error as Error | undefined)?.message ?? error),
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
        body: { olderThanHours: 1 },
        headers: sessionHeaders(sessionToken),
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: `Cleaned ${data.deleted} empty note(s)` });
      await fetchList(sessionToken, search, tagFilter);
    } catch (error) {
      toast({
        title: "Cleanup error",
        description: String((error as Error | undefined)?.message ?? error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    const tokenToRevoke = sessionToken;
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    setGate("denied");
    setSessionToken("");
    setItems([]);
    if (tokenToRevoke) {
      void supabase.functions.invoke("admin-session", {
        method: "DELETE",
        headers: sessionHeaders(tokenToRevoke),
      });
    }
  };

  if (gate !== "allowed") return <NotFound />;

  return (
    <div className="min-h-svh bg-background">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-semibold">Admin Â· {total} note</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={runCleanup} disabled={loading}>
            <Sparkles className="h-3.5 w-3.5" />
            Clean empty notes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRotateOpen(true)} disabled={loading}>
            <KeyRound className="h-3.5 w-3.5" />
            Rotate key
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fetchList(sessionToken, search, tagFilter)} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={logout}>Logout</Button>
        </div>
      </header>

      <RotatePassDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        sessionToken={sessionToken}
        onSuccess={() => void fetchList(sessionToken, search, tagFilter)}
      />

      <div className="mx-auto max-w-5xl p-4">
        <form onSubmit={onSearch} className="mb-3 flex gap-2">
          <div className="flex flex-1 items-center rounded-md border border-input bg-background px-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              // eslint-disable-next-line no-restricted-syntax -- internal admin-only UI
              placeholder="Search by slug or contentâ€¦"
              className="border-0 focus-visible:ring-0"
            />
          </div>
          <Button type="submit" variant="outline" disabled={loading}>Search</Button>
        </form>

        {(topTags.length > 0 || tagFilter) && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Tags:</span>
            {tagFilter && (
              <button
                onClick={() => applyTag(tagFilter)}
                className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background"
              >
                #{tagFilter}<X className="h-3 w-3" />
              </button>
            )}
            {topTags.filter((tag) => tag.name !== tagFilter).map((tag) => (
              <button
                key={tag.name}
                onClick={() => applyTag(tag.name)}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground hover:text-foreground"
              >
                #{tag.name}<span className="ml-1 opacity-60">{tag.count}</span>
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
              <Trash2 className="h-3.5 w-3.5" /> Delete selected
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
          {items.map((note) => (
            <li key={note.slug} className="flex items-start gap-3 px-3 py-2 hover:bg-accent/40">
              <Checkbox
                checked={selected.has(note.slug)}
                onCheckedChange={() => toggle(note.slug)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link to={`/${note.slug}`} target="_blank" className="font-mono text-sm hover:underline">
                    /{note.slug}
                  </Link>
                  {note.is_encrypted && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">ðŸ”’</span>}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {note.char_count} chars Â· {new Date(note.updated_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {note.preview || "(empty)"}
                </p>
                {note.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {note.tags.slice(0, 8).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => applyTag(tag)}
                        className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
          {items.length === 0 && !loading && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No notes.</li>
          )}
        </ul>
      </div>

      <AlertDialog open={confirmOpen !== null} onOpenChange={(open) => !open && setConfirmOpen(null)}>
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
              onClick={() => confirmOpen && void doDelete(confirmOpen)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

