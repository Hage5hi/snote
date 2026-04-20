import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { FileText, Home as HomeIcon, Plus, Shuffle } from "lucide-react";
import { getRecents } from "@/lib/recent-notes";

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function randomSlug() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Global Cmd/Ctrl+K palette. Mounted once at the App level.
 *  - Search slug → if exact + valid, "Open /{slug}" appears at top.
 *  - Lists recent notes (from localStorage).
 *  - Quick actions: random note, home.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState(() => getRecents());
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setRecents(getRecents());
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Refresh recents whenever the palette opens.
  useEffect(() => {
    if (open) setRecents(getRecents());
  }, [open]);

  const go = (slug: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/${slug}`);
  };

  const trimmed = query.trim();
  const isValidNew = SLUG_RE.test(trimmed);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Tìm note hoặc gõ slug để mở…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>Không tìm thấy. Gõ slug hợp lệ để tạo mới.</CommandEmpty>

        {isValidNew && (
          <>
            <CommandGroup heading="Mở / Tạo">
              <CommandItem value={`open-${trimmed}`} onSelect={() => go(trimmed)}>
                <Plus className="h-4 w-4" />
                Mở <span className="font-mono">/{trimmed}</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {recents.length > 0 && (
          <>
            <CommandGroup heading="Note gần đây">
              {recents.slice(0, 20).map((r) => (
                <CommandItem
                  key={r.slug}
                  value={`recent-${r.slug}`}
                  onSelect={() => go(r.slug)}
                >
                  <FileText className="h-4 w-4" />
                  <span className="font-mono">/{r.slug}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Hành động">
          <CommandItem value="action-random" onSelect={() => go(randomSlug())}>
            <Shuffle className="h-4 w-4" />
            Note ngẫu nhiên
          </CommandItem>
          <CommandItem
            value="action-home"
            onSelect={() => {
              setOpen(false);
              navigate("/");
            }}
          >
            <HomeIcon className="h-4 w-4" />
            Về trang chủ
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
