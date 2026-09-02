import { useEffect, useLayoutEffect, useState } from "react";
import { HomeTagFilter } from "@/components/home/HomeTagFilter";
import { HomeCollections } from "@/components/home/HomeCollections";
import {
  deleteCollection,
  filterByIndexTags,
  filterPinnedByIndexTags,
  getCollections,
  indexTagsBySlug,
  parseHomeTagFilter,
  upsertCollection,
  type VirtualCollection,
} from "@/lib/home-library";
import {
  getNoteIndexSnapshot,
  hydrateNoteIndex,
  subscribeNoteIndex,
} from "@/lib/note-index";
import { useI18n } from "@/i18n";
import type { RecentNote } from "@/lib/recent-notes";

export default function HomeLibraryPanel({
  recents,
  pinned,
  onListsChange,
}: {
  recents: RecentNote[];
  pinned: string[];
  onListsChange: (lists: { pinned: string[]; recents: RecentNote[] }) => void;
}) {
  const { t } = useI18n();
  const [tagQuery, setTagQuery] = useState("");
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collections, setCollections] = useState(() => getCollections());
  const [indexTick, setIndexTick] = useState(0);

  useEffect(() => {
    const unsub = subscribeNoteIndex(() => setIndexTick((n) => n + 1));
    void hydrateNoteIndex().finally(() => setIndexTick((n) => n + 1));
    return unsub;
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "note.collections") setCollections(getCollections());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useLayoutEffect(() => {
    const next = parseHomeTagFilter(tagQuery);
    const tagsBySlug = indexTagsBySlug(getNoteIndexSnapshot());
    onListsChange({
      pinned: filterPinnedByIndexTags(pinned, tagsBySlug, next),
      recents: filterByIndexTags(recents, tagsBySlug, next).slice(0, 12),
    });
  }, [tagQuery, recents, pinned, indexTick, onListsChange]);

  const filter = parseHomeTagFilter(tagQuery);
  const tagsBySlug = indexTagsBySlug(getNoteIndexSnapshot());
  const visiblePinned = filterPinnedByIndexTags(pinned, tagsBySlug, filter);
  const visibleRecents = filterByIndexTags(recents, tagsBySlug, filter).slice(0, 12);
  const knownTags = [...new Set(
    [...pinned, ...recents.map((row) => row.slug)].flatMap((s) => tagsBySlug.get(s) ?? []),
  )].sort();
  const hasLibrary = recents.length > 0 || pinned.length > 0;
  const filterMiss = hasLibrary && filter.active && visiblePinned.length === 0 && visibleRecents.length === 0;

  const onFilterChange = (value: string) => {
    setTagQuery(value);
    const next = parseHomeTagFilter(value);
    const current = collections.find((row) => row.id === activeCollectionId);
    if (current && current.tags.join("\0") !== next.tags.join("\0")) {
      setActiveCollectionId(null);
    }
  };

  const applyCollection = (collection: VirtualCollection | null) => {
    if (!collection) {
      setActiveCollectionId(null);
      return;
    }
    setActiveCollectionId(collection.id);
    setTagQuery(collection.tags.map((tag) => `#${tag}`).join(" "));
  };

  if (!hasLibrary) return null;

  return (
    <div className="mt-10 space-y-4">
      <HomeTagFilter value={tagQuery} onChange={onFilterChange} knownTags={knownTags} />
      <HomeCollections
        collections={collections}
        activeId={activeCollectionId}
        canSave={filter.tags.length > 0}
        draftTags={filter.tags}
        onSelect={applyCollection}
        onSave={(name) => {
          const saved = upsertCollection({ name, tags: filter.tags });
          if (!saved) return;
          setCollections(getCollections());
          setActiveCollectionId(saved.id);
        }}
        onRename={(id, name) => {
          const current = collections.find((row) => row.id === id);
          if (!current) return;
          const saved = upsertCollection({ id, name, tags: current.tags });
          if (!saved) return;
          setCollections(getCollections());
        }}
        onDelete={(id) => {
          setCollections(deleteCollection(id));
          if (activeCollectionId === id) {
            setActiveCollectionId(null);
          }
        }}
      />
      {filterMiss && (
        <p className="text-sm text-muted-foreground">{t("home.filter.empty")}</p>
      )}
    </div>
  );
}
