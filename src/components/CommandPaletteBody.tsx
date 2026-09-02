import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
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
import { isUsableSlug } from "@/lib/slug";
import { useI18n } from "@/i18n/index";
import {
  collectKnowledgeSearchDocs,
  parseKnowledgeQuery,
  rankKnowledgeSearch,
} from "@/lib/knowledge-search";
import {
  hydrateNoteIndex,
  isNoteIndexHydrated,
  subscribeNoteIndex,
} from "@/lib/note-index";

function prefetchSlug(s: string) {
  // Never fetch legacy plaintext on hover after direct-table cutover.
  void s;
}

function softNavigate(navigate: (p: string) => void, path: string) {
  const w = document as unknown as { startViewTransition?: (cb: () => void) => unknown };
  if (w.startViewTransition) w.startViewTransition(() => navigate(path));
  else navigate(path);
}

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
  seedQuery?: string;
  seedNonce?: number;
}

export default function CommandPaletteBody({
  open,
  onOpenChange,
  onOpenHelp,
  seedQuery = "",
  seedNonce = 0,
}: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState(seedQuery);
  const [recents, setRecents] = useState(() => getRecents());
  const [pinned, setPinned] = useState<string[]>(() => getPinned());
  const [indexReady, setIndexReady] = useState(isNoteIndexHydrated);
  const [, setIndexTick] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setRecents(getRecents());
    setPinned(getPinned());
    const unsub = subscribeNoteIndex(() => {
      setIndexTick((n) => n + 1);
      setIndexReady(isNoteIndexHydrated());
    });
    if (isNoteIndexHydrated()) {
      setIndexReady(true);
    } else {
      setIndexReady(false);
      void hydrateNoteIndex().finally(() => setIndexReady(isNoteIndexHydrated()));
    }
    return unsub;
  }, [open]);

  useEffect(() => {
    if (open && seedNonce > 0 && seedQuery) setQuery(seedQuery);
  }, [open, seedQuery, seedNonce]);

  const go = (slug: string) => {
    onOpenChange(false);
    setQuery("");
    softNavigate(navigate, `/${slug}`);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) setQuery("");
    onOpenChange(v);
  };

  const handleTogglePin = (slug: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinned(togglePin(slug));
  };

  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const parsed = parseKnowledgeQuery(query);
  const hits = searching ? rankKnowledgeSearch(parsed, collectKnowledgeSearchDocs()) : [];
  const hitSlugs = new Set(hits.map((hit) => hit.slug));
  const isValidNew = isUsableSlug(trimmed) && parsed.tag === null && !hitSlugs.has(trimmed);
  const pinnedSet = new Set(pinned);
  const pinnedItems = pinned
    .map((slug) => recents.find((r) => r.slug === slug) ?? { slug, lastOpenedAt: 0 })
    .filter(Boolean) as ReturnType<typeof getRecents>;
  const unpinnedRecents = recents.filter((r) => !pinnedSet.has(r.slug));

  const emptyCopy = parsed.tag === ""
    ? t("cmdk.empty_tag_hint")
    : parsed.tag
      ? t("cmdk.empty_tag", { tag: parsed.tag })
      : t("cmdk.empty");

  const createGroup = isValidNew ? (
    <CommandGroup heading={t("cmdk.group_open")}>
      <CommandItem value={`open-${trimmed}`} onSelect={() => go(trimmed)}>
        <Plus className="h-4 w-4" />
        {t("cmdk.item_open")} <span className="font-mono">/{trimmed}</span>
      </CommandItem>
    </CommandGroup>
  ) : null;

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder={t("cmdk.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {!indexReady && (
          <p role="status" className="px-3 py-1.5 text-xs text-muted-foreground">{t("cmdk.indexing")}</p>
        )}
        {indexReady && <CommandEmpty>{emptyCopy}</CommandEmpty>}

        {searching && hits.length === 0 && createGroup}

        {searching ? (
          hits.length > 0 && (
            <CommandGroup heading={parsed.tag ? t("cmdk.group_tag", { tag: parsed.tag }) : t("cmdk.group_notes")}>
              {hits.map((hit) => {
                const isPinnedHit = pinnedSet.has(hit.slug);
                const primary = hit.title?.trim() || `/${hit.slug}`;
                const secondaryBits = [
                  hit.title ? `/${hit.slug}` : null,
                  hit.snippet,
                ].filter(Boolean);
                return (
                  <CommandItem
                    key={hit.slug}
                    value={`note-${hit.slug}`}
                    onSelect={() => go(hit.slug)}
                    onMouseEnter={() => prefetchSlug(hit.slug)}
                  >
                    {isPinnedHit
                      ? <Pin className="h-4 w-4 shrink-0 text-primary" />
                      : <FileText className="h-4 w-4 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{primary}</span>
                      {secondaryBits.length > 0 && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {secondaryBits.join(" · ")}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleTogglePin(hit.slug, e)}
                      className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={
                        isPinnedHit
                          ? t("cmdk.unpin_aria", { slug: hit.slug })
                          : t("cmdk.pin_aria", { slug: hit.slug })
                      }
                      title={isPinnedHit ? t("cmdk.unpin_title") : t("cmdk.pin_title")}
                    >
                      {isPinnedHit
                        ? <PinOff className="h-3.5 w-3.5" />
                        : <Pin className="h-3.5 w-3.5" />}
                    </button>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )
        ) : (
          <>
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
          </>
        )}
        {searching && hits.length > 0 && createGroup}
      </CommandList>
    </CommandDialog>
  );
}
