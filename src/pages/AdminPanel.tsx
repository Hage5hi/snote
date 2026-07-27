import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Trash2, Search, RefreshCw, X, KeyRound } from "lucide-react";
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
type RequestOwnership = "owned" | "stale" | "superseded";

// This stores a random, short-lived server session only. It never contains the
// admin passphrase supplied through the scrubbed URL fragment.
const SESSION_TOKEN_KEY = "__a_session";
const SESSION_EXPIRY_KEY = "__a_session_expiry";
const MAX_CACHED_SESSION_TTL_MS = 31 * 60 * 1000;

function parseSessionExpiry(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const expiresAtMs = Date.parse(value);
  return Number.isFinite(expiresAtMs) ? expiresAtMs : null;
}

function remainingSessionLifetime(expiresAt: string): number | null {
  const expiresAtMs = parseSessionExpiry(expiresAt);
  if (expiresAtMs === null) return null;
  const remainingMs = expiresAtMs - Date.now();
  return remainingMs > 0 && remainingMs <= MAX_CACHED_SESSION_TTL_MS
    ? remainingMs
    : null;
}

function readStoredAdminSession(): { token: string; expiresAt: string } | null {
  try {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
    const expiresAt = sessionStorage.getItem(SESSION_EXPIRY_KEY) ?? "";
    return token && remainingSessionLifetime(expiresAt) !== null
      ? { token, expiresAt }
      : null;
  } catch {
    return null;
  }
}

function readStoredSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storedSessionIsCurrent(token: string): boolean {
  const stored = readStoredAdminSession();
  return stored?.token === token;
}

function isUnauthorizedAdminResponse(error: unknown, data: unknown): boolean {
  const candidate = error && typeof error === "object"
    ? error as { status?: unknown; context?: { status?: unknown } }
    : null;
  const directStatus = Number(candidate?.status);
  const contextStatus = Number(candidate?.context?.status);
  const status = Number.isFinite(contextStatus) ? contextStatus : directStatus;
  const apiError = data && typeof data === "object" && "error" in data
    ? String((data as { error?: unknown }).error ?? "").trim().toLowerCase()
    : "";
  const message = String((error as { message?: unknown } | null)?.message ?? "")
    .toLowerCase();
  return status === 401 || status === 403 ||
    /^(unauthorized|session (expired|invalid))$/.test(apiError) ||
    message.includes("unauthorized") || message.includes("session expired");
}

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
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const expiryTimerRef = useRef<number | null>(null);
  const sessionGenerationRef = useRef(0);
  const activeSessionTokenRef = useRef("");
  const latestListRequestRef = useRef(0);

  const purgeAdminState = useCallback(
    (removeStoredSession: boolean) => {
      sessionGenerationRef.current += 1;
      latestListRequestRef.current += 1;
      setSessionGeneration(sessionGenerationRef.current);
      activeSessionTokenRef.current = "";
      if (expiryTimerRef.current !== null) {
        window.clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
      if (removeStoredSession) {
        try {
          sessionStorage.removeItem(SESSION_TOKEN_KEY);
          sessionStorage.removeItem(SESSION_EXPIRY_KEY);
        } catch {
          // Storage may be disabled. Rendered state is still purged below.
        }
      }
      setGate("denied");
      setSessionToken("");
      setLoading(false);
      setItems([]);
      setTotal(0);
      setTopTags([]);
      setSelected(new Set());
      setSearch("");
      setTagFilter("");
      setConfirmOpen(null);
      setRotateOpen(false);
    },
    [],
  );

  const clearAdminSession = useCallback(() => {
    purgeAdminState(true);
  }, [purgeAdminState]);

  const retireStaleAdminView = useCallback(() => {
    // A different component instance already stored a newer session. Hide this
    // instance's previews without deleting the newer token from sessionStorage.
    purgeAdminState(false);
  }, [purgeAdminState]);

  const requestOwnership = useCallback(
    (token: string, generation: number): RequestOwnership => {
      if (
        sessionGenerationRef.current !== generation ||
        activeSessionTokenRef.current !== token
      ) {
        return "stale";
      }
      const storedToken = readStoredSessionToken();
      return storedToken !== null && storedToken !== token
        ? "superseded"
        : "owned";
    },
    [],
  );

  const clearRejectedSession = useCallback(
    (token: string, generation: number): boolean => {
      const ownership = requestOwnership(token, generation);
      if (ownership === "stale") return false;
      if (ownership === "superseded") {
        retireStaleAdminView();
        return false;
      }
      clearAdminSession();
      return true;
    },
    [clearAdminSession, requestOwnership, retireStaleAdminView],
  );

  const beginAdminRequest = useCallback(
    (token: string, expectedGeneration?: number): number | null => {
      const generation = expectedGeneration ?? sessionGenerationRef.current;
      const ownership = requestOwnership(token, generation);
      if (ownership === "stale") return null;
      if (ownership === "superseded") {
        retireStaleAdminView();
        return null;
      }
      if (!storedSessionIsCurrent(token)) {
        clearAdminSession();
        return null;
      }
      return generation;
    },
    [clearAdminSession, requestOwnership, retireStaleAdminView],
  );

  const scheduleSessionExpiry = useCallback(
    (token: string, expiresAt: string): boolean => {
      const remainingMs = remainingSessionLifetime(expiresAt);
      if (remainingMs === null) {
        clearAdminSession();
        return false;
      }

      try {
        sessionStorage.setItem(SESSION_TOKEN_KEY, token);
        sessionStorage.setItem(SESSION_EXPIRY_KEY, expiresAt);
      } catch {
        clearAdminSession();
        return false;
      }

      if (expiryTimerRef.current !== null) {
        window.clearTimeout(expiryTimerRef.current);
      }
      sessionGenerationRef.current += 1;
      const generation = sessionGenerationRef.current;
      setSessionGeneration(generation);
      activeSessionTokenRef.current = token;
      expiryTimerRef.current = window.setTimeout(() => {
        const ownership = requestOwnership(token, generation);
        if (ownership === "stale") return;
        if (ownership === "superseded") {
          retireStaleAdminView();
          return;
        }
        clearAdminSession();
      }, remainingMs);
      return true;
    },
    [clearAdminSession, requestOwnership, retireStaleAdminView],
  );

  const fetchList = useCallback(
    async (token: string, query = "", tag = "") => {
      const requestGeneration = beginAdminRequest(token);
      if (requestGeneration === null) return false;
      const listRequestId = ++latestListRequestRef.current;
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("admin-list", {
          body: { search: query, tag, limit: 200, offset: 0 },
          headers: sessionHeaders(token),
        });
        if (listRequestId !== latestListRequestRef.current) return false;
        const ownership = requestOwnership(token, requestGeneration);
        if (ownership === "stale") return false;
        if (ownership === "superseded") {
          retireStaleAdminView();
          return false;
        }
        if (isUnauthorizedAdminResponse(error, data)) {
          if (clearRejectedSession(token, requestGeneration)) {
            toast({
              title: "Failed to load list",
              description: "Session expired.",
              variant: "destructive",
            });
          }
          return false;
        }
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (!storedSessionIsCurrent(token)) {
          clearAdminSession();
          return false;
        }
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setTopTags(data.topTags ?? []);
        setSelected(new Set());
        return true;
      } catch (error) {
        if (listRequestId !== latestListRequestRef.current) return false;
        const ownership = requestOwnership(token, requestGeneration);
        if (ownership === "stale") return false;
        if (ownership === "superseded") {
          retireStaleAdminView();
          return false;
        }
        const message = String((error as Error | undefined)?.message ?? error);
        const unauthorized = isUnauthorizedAdminResponse(error, null);
        if (unauthorized && !clearRejectedSession(token, requestGeneration)) {
          return false;
        }
        if (!unauthorized && !storedSessionIsCurrent(token)) {
          clearAdminSession();
          return false;
        }
        toast({
          title: "Failed to load list",
          description: unauthorized ? "Session expired." : message,
          variant: "destructive",
        });
        return false;
      } finally {
        if (
          listRequestId === latestListRequestRef.current &&
          requestOwnership(token, requestGeneration) === "owned"
        ) {
          setLoading(false);
        }
      }
    },
    [
      beginAdminRequest,
      clearAdminSession,
      clearRejectedSession,
      requestOwnership,
      retireStaleAdminView,
    ],
  );

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow,noarchive";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
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
        const storedSession = readStoredAdminSession();
        let opaqueToken = storedSession?.token ?? "";
        let expiresAt = storedSession?.expiresAt ?? "";
        if (fragmentPassphrase) {
          const { data, error } = await supabase.functions.invoke("admin-session", {
            body: { passphrase: fragmentPassphrase },
          });
          fragmentPassphrase = "";
          if (error || !data?.sessionToken || !data?.expiresAt) {
            throw error ?? new Error("unauthorized");
          }
          opaqueToken = String(data.sessionToken);
          expiresAt = String(data.expiresAt);
        }
        if (!opaqueToken || remainingSessionLifetime(expiresAt) === null) {
          throw new Error("unauthorized");
        }

        const { data, error } = await supabase.functions.invoke("admin-list", {
          body: { limit: 1, offset: 0, tag: fragmentTag },
          headers: sessionHeaders(opaqueToken),
        });
        if (cancelled) return;
        if (isUnauthorizedAdminResponse(error, data)) {
          throw error ?? new Error("unauthorized");
        }
        if (error || data?.error) throw error ?? new Error(String(data?.error));
        if (!scheduleSessionExpiry(opaqueToken, expiresAt)) return;

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
        clearAdminSession();
      }
    })();

    return () => {
      cancelled = true;
      fragmentPassphrase = "";
      if (expiryTimerRef.current !== null) {
        window.clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };
  }, [clearAdminSession, fetchList, scheduleSessionExpiry]);

  useEffect(() => {
    if (gate !== "allowed" || !sessionToken) return;
    const revalidate = () => {
      beginAdminRequest(sessionToken);
    };
    revalidate();
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [beginAdminRequest, gate, sessionToken]);

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
    const requestGeneration = beginAdminRequest(sessionToken);
    if (requestGeneration === null) return;
    setLoading(true);
    try {
      const body = mode === "all" ? { all: true } : { slugs: Array.from(selected) };
      const { data, error } = await supabase.functions.invoke("admin-delete", {
        body,
        headers: sessionHeaders(sessionToken),
      });
      const ownership = requestOwnership(sessionToken, requestGeneration);
      if (ownership === "stale") return;
      if (ownership === "superseded") {
        retireStaleAdminView();
        return;
      }
      if (isUnauthorizedAdminResponse(error, data)) {
        if (clearRejectedSession(sessionToken, requestGeneration)) {
          toast({
            title: "Delete failed",
            description: "Session expired.",
            variant: "destructive",
          });
        }
        return;
      }
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!storedSessionIsCurrent(sessionToken)) {
        clearAdminSession();
        return;
      }
      toast({ title: `Deleted ${data.deleted} note(s)` });
      await fetchList(sessionToken, search, tagFilter);
    } catch (error) {
      const ownership = requestOwnership(sessionToken, requestGeneration);
      if (ownership === "stale") return;
      if (ownership === "superseded") {
        retireStaleAdminView();
        return;
      }
      const unauthorized = isUnauthorizedAdminResponse(error, null);
      if (
        unauthorized &&
        !clearRejectedSession(sessionToken, requestGeneration)
      ) {
        return;
      }
      if (!unauthorized && !storedSessionIsCurrent(sessionToken)) {
        clearAdminSession();
        return;
      }
      toast({
        title: "Delete failed",
        description: unauthorized
          ? "Session expired."
          : String((error as Error | undefined)?.message ?? error),
        variant: "destructive",
      });
    } finally {
      if (requestOwnership(sessionToken, requestGeneration) === "owned") {
        setLoading(false);
        setConfirmOpen(null);
      }
    }
  };

  const openDeleteConfirmation = (mode: "selected" | "all") => {
    if (beginAdminRequest(sessionToken) !== null) setConfirmOpen(mode);
  };

  const openRotateDialog = () => {
    if (beginAdminRequest(sessionToken) !== null) setRotateOpen(true);
  };

  const validateRotateSession = useCallback(
    (token: string, generation: number) =>
      beginAdminRequest(token, generation) !== null,
    [beginAdminRequest],
  );

  const handleRotateUnauthorized = useCallback(
    (token: string, generation: number) =>
      clearRejectedSession(token, generation),
    [clearRejectedSession],
  );

  const logout = () => {
    const tokenToRevoke = sessionToken;
    clearAdminSession();
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
        <h1 className="font-semibold">Admin · {total} note</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={openRotateDialog} disabled={loading}>
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
        sessionGeneration={sessionGeneration}
        validateSession={validateRotateSession}
        onUnauthorized={handleRotateUnauthorized}
        onSuccess={handleRotateUnauthorized}
      />

      <div className="mx-auto max-w-5xl p-4">
        <form onSubmit={onSearch} className="mb-3 flex gap-2">
          <div className="flex flex-1 items-center rounded-md border border-input bg-background px-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              // eslint-disable-next-line no-restricted-syntax -- internal admin-only UI
              placeholder="Search by slug or content…"
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
              onClick={() => openDeleteConfirmation("selected")}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || items.length === 0}
              onClick={() => openDeleteConfirmation("all")}
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
                  {note.is_encrypted && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">🔒</span>}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {note.char_count} chars · {new Date(note.updated_at).toLocaleString()}
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
