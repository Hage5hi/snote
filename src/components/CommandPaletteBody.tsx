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
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/index";

function prefetchSlug(s: string) {
  const key = `note-prefetch:${s}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  void supabase
    .from("notes")
    .select("ydoc_state, is_encrypted")
    .eq("slug", s)
    .maybeSingle()
    .then(({ data }) => {
      if (data?.ydoc_state && !data?.is_encrypted) {
        try {
          sessionStorage.setItem(`note-snapshot:${s}`, data.ydoc_state);
        } catch {
          /* quota */
        }
      }
    });
}

function softNavigate(navigate: (p: string) => void, path: string) {
  const w = document as unknown as { startViewTransition?: (cb: () => void) => unknown };
  if (w.startViewTransition) w.startViewTransition(() => navigate(path));
  else navigate(path);
}

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function randomSlug() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenHelp: () => void;
}

export default function CommandPaletteBody({ open, onOpenChange, onOpenHelp }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState(() => getRecents());
  const [pinned, setPinned] = useState<string[]>(() => getPinned());
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setRecents(getRecents());
      setPinned(getPinned());
    }
  }, [open]);

  const go = (slug: string) => {
    onOpenChange(false);
    setQuery("");
    softNavigate(navigate, `/${slug}`);
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
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={t("cmdk.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{t("cmdk.empty")}</CommandEmpty>

        {isValidNew && (
          <>
            <CommandGroup heading={t("cmdk.group_open")}>
              <CommandItem value={`open-${trimmed}`} onSelect={() => go(trimmed)}>
                <Plus className="h-4 w-4" />
                {t("cmdk.item_open")} <span className="font-mono">/{trimmed}</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {pinnedItems.length > 0 && (
          <>
            <CommandGroup heading={t("cmdk.group_pinned")}>
              {pinnedItems.map((r) => (
                <CommandItem
                  key={r.slug}
                  value={`pinned-${r.slug}`}
                  onSelect={() => go(r.slug)}
                  onMouseEnter={() => prefetchSlug(r.slug)}
                >
                  <Pin className="h-4 w-4 text-primary" />
                  <span className="font-mono flex-1">/{r.slug}</span>
                  <button
                    type="button"
                    onClick={(e) => handleTogglePin(r.slug, e)}
                    className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={t("cmdk.unpin_aria", { slug: r.slug })}
                    title={t("cmdk.unpin_title")}
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
            <CommandGroup heading={t("cmdk.group_recents")}>
              {unpinnedRecents.slice(0, 20).map((r) => (
                <CommandItem
                  key={r.slug}
                  value={`recent-${r.slug}`}
                  onSelect={() => go(r.slug)}
                  onMouseEnter={() => prefetchSlug(r.slug)}
                >
                  <FileText className="h-4 w-4" />
                  <span className="font-mono flex-1">/{r.slug}</span>
                  <button
                    type="button"
                    onClick={(e) => handleTogglePin(r.slug, e)}
                    className="ml-auto rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[selected=true]:opacity-100"
                    aria-label={t("cmdk.pin_aria", { slug: r.slug })}
                    title={t("cmdk.pin_title")}
                  >
                    <Pin className="h-3.5 w-3.5" />
                  </button>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading={t("cmdk.group_actions")}>
          <CommandItem value="action-random" onSelect={() => go(randomSlug())}>
            <Shuffle className="h-4 w-4" />
            {t("cmdk.random")}
          </CommandItem>
          <CommandItem
            value="action-home"
            onSelect={() => {
              onOpenChange(false);
              navigate("/");
            }}
          >
            <HomeIcon className="h-4 w-4" />
            {t("cmdk.home")}
          </CommandItem>
          <CommandItem
            value="action-shortcuts"
            onSelect={() => {
              onOpenChange(false);
              onOpenHelp();
            }}
          >
            <Keyboard className="h-4 w-4" />
            {t("cmdk.shortcuts")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
