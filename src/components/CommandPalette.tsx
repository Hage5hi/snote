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
import { FileText, Home as HomeIcon, Keyboard, Pin, PinOff, Plus, Shuffle } from "lucide-react";
import { getRecents, getPinned, togglePin } from "@/lib/recent-notes";
import { ShortcutHelp } from "./ShortcutHelp";

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function randomSlug() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Global Cmd/Ctrl+K palette + ? shortcut help. Mounted once at App level.
 *  - Search slug → if exact + valid, "Open /{slug}" appears at top.
 *  - Pinned slugs are shown above recents and persisted in localStorage.
 *  - Quick actions: random, home, show shortcuts.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState(() => getRecents());
  const [pinned, setPinned] = useState<string[]>(() => getPinned());
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setRecents(getRecents());
        setPinned(getPinned());
        setOpen((v) => !v);
        return;
      }
      // "?" → open shortcut help, but ignore when typing in any input/editor.
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t) {
          const tag = t.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
        }
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Refresh recents/pinned whenever the palette opens.
  useEffect(() => {
    if (open) {
      setRecents(getRecents());
      setPinned(getPinned());
    }
  }, [open]);

  const go = (slug: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/${slug}`);
  };

  const handleTogglePin = (slug: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinned(togglePin(slug));
  };

  const trimmed = query.trim();
  const isValidNew = SLUG_RE.test(trimmed);
  const pinnedSet = new Set(pinned);
  const pinnedItems = pinned
    .map((slug) => recents.find((r) => r.slug === slug) ?? { slug, lastOpenedAt: 0 })
    .filter(Boolean) as ReturnType<typeof getRecents>;
  const unpinnedRecents = recents.filter((r) => !pinnedSet.has(r.slug));

  return (
    <>
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

          {pinnedItems.length > 0 && (
            <>
              <CommandGroup heading="Đã ghim">
                {pinnedItems.map((r) => (
                  <CommandItem
                    key={r.slug}
                    value={`pinned-${r.slug}`}
                    onSelect={() => go(r.slug)}
                  >
                    <Pin className="h-4 w-4 text-primary" />
                    <span className="font-mono flex-1">/{r.slug}</span>
                    <button
                      type="button"
                      onClick={(e) => handleTogglePin(r.slug, e)}
                      className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Bỏ ghim /${r.slug}`}
                      title="Bỏ ghim"
                    >
                      <PinOff className="h-3.5 w-3.5" />
                    </button>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {unpinnedRecents.length > 0 && (
            <>
              <CommandGroup heading="Note gần đây">
                {unpinnedRecents.slice(0, 20).map((r) => (
                  <CommandItem
                    key={r.slug}
                    value={`recent-${r.slug}`}
                    onSelect={() => go(r.slug)}
                  >
                    <FileText className="h-4 w-4" />
                    <span className="font-mono flex-1">/{r.slug}</span>
                    <button
                      type="button"
                      onClick={(e) => handleTogglePin(r.slug, e)}
                      className="ml-auto rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[selected=true]:opacity-100"
                      aria-label={`Ghim /${r.slug}`}
                      title="Ghim note"
                    >
                      <Pin className="h-3.5 w-3.5" />
                    </button>
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
            <CommandItem
              value="action-shortcuts"
              onSelect={() => {
                setOpen(false);
                setHelpOpen(true);
              }}
            >
              <Keyboard className="h-4 w-4" />
              Xem phím tắt
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
