import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Trash2, Search, RefreshCw, Sparkles, X } from "lucide-react";
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

const SESSION_KEY = "admin.passphrase";

export default function AdminPanel() {
  const [pass, setPass] = useState("");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdminNote[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [topTags, setTopTags] = useState<TopTag[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState<null | "selected" | "all">(null);

  // Restore passphrase from session storage so a hard refresh doesn't kick out.
  useEffect(() => {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      setPass(cached);
      setAuthed(true);
    }
  }, []);

  const fetchList = async (passToUse: string, q = "") => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-list", {
        body: { passphrase: passToUse, search: q, limit: 200, offset: 0 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
      return true;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      toast({
        title: "Không tải được danh sách",
        description: msg.includes("unauthorized") ? "Khoá admin sai." : msg,
        variant: "destructive",
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass.trim()) return;
    const ok = await fetchList(pass);
    if (ok) {
      sessionStorage.setItem(SESSION_KEY, pass);
      setAuthed(true);
    }
  };

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetchList(pass, search);
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
      const body: any = { passphrase: pass };
      if (mode === "all") body.all = true;
      else body.slugs = Array.from(selected);
      const { data, error } = await supabase.functions.invoke("admin-delete", {
        body,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: `Đã xoá ${data.deleted} note` });
      await fetchList(pass, search);
    } catch (e: any) {
      toast({
        title: "Xoá thất bại",
        description: String(e?.message ?? e),
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
      toast({ title: `Đã dọn ${data.deleted} note rỗng` });
      await fetchList(pass, search);
    } catch (e: any) {
      toast({ title: "Cleanup lỗi", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setPass("");
    setAuthed(false);
    setItems([]);
  };

  if (!authed) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <form
          onSubmit={onLogin}
          className="w-full max-w-sm space-y-4 rounded-md border border-border p-6"
        >
          <div className="flex items-center gap-2">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-lg font-semibold">Admin</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Nhập khoá admin để xem và quản lý toàn bộ note.
          </p>
          <Input
            type="password"
            placeholder="Khoá admin"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoFocus
          />
          <Button type="submit" className="w-full" disabled={loading || !pass.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Đăng nhập"}
          </Button>
        </form>
      </div>
    );
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
            Dọn note rỗng
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fetchList(pass, search)} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={logout}>
            Logout
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl p-4">
        <form onSubmit={onSearch} className="mb-3 flex gap-2">
          <div className="flex flex-1 items-center rounded-md border border-input bg-background px-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo slug hoặc nội dung…"
              className="border-0 focus-visible:ring-0"
            />
          </div>
          <Button type="submit" variant="outline" disabled={loading}>
            Tìm
          </Button>
        </form>

        <div className="mb-2 flex items-center gap-2 text-xs">
          <Checkbox
            checked={items.length > 0 && selected.size === items.length}
            onCheckedChange={toggleAll}
          />
          <span className="text-muted-foreground">
            {selected.size} đang chọn / {items.length} hiển thị
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={selected.size === 0 || loading}
              onClick={() => setConfirmOpen("selected")}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Xoá đã chọn
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || items.length === 0}
              onClick={() => setConfirmOpen("all")}
            >
              Xoá TẤT CẢ
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
                  {n.preview || "(rỗng)"}
                </p>
              </div>
            </li>
          ))}
          {items.length === 0 && !loading && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              Không có note nào.
            </li>
          )}
        </ul>
      </div>

      <AlertDialog open={confirmOpen !== null} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmOpen === "all" ? "Xoá TẤT CẢ note?" : `Xoá ${selected.size} note?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Hành động này không thể hoàn tác. Nội dung sẽ bị xoá vĩnh viễn khỏi server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmOpen && doDelete(confirmOpen)}
            >
              Xoá
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
