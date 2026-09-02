import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import type { VirtualCollection } from "@/lib/home-library";
import { cn } from "@/lib/utils";

export function HomeCollections({
  collections,
  activeId,
  canSave,
  draftTags,
  onSelect,
  onSave,
  onRename,
  onDelete,
}: {
  collections: VirtualCollection[];
  activeId: string | null;
  canSave: boolean;
  draftTags: string[];
  onSelect: (collection: VirtualCollection | null) => void;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  return (
    <section className="space-y-2" aria-label={t("home.collections.aria")}>
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("home.collections.title")}
      </h2>
      {collections.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {collections.map((collection) => {
            const selected = collection.id === activeId;
            const editing = editingId === collection.id;
            return (
              <li
                key={collection.id}
                className={cn(
                  "group flex items-stretch overflow-hidden rounded-md border",
                  selected ? "border-foreground/30 bg-accent" : "border-border bg-background",
                )}
              >
                {editing ? (
                  <form
                    className="flex items-center gap-1 px-1.5 py-0.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      onRename(collection.id, editingName);
                      setEditingId(null);
                    }}
                  >
                    <label htmlFor={`home-collection-rename-${collection.id}`} className="sr-only">
                      {t("home.collections.rename_aria", { name: collection.name })}
                    </label>
                    <Input
                      id={`home-collection-rename-${collection.id}`}
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-7 w-28 px-1.5 text-xs"
                      autoFocus
                    />
                    <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      {t("home.collections.rename")}
                    </Button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className="px-2.5 py-1 text-xs"
                      onClick={() => onSelect(selected ? null : collection)}
                    >
                      {collection.name}
                    </button>
                    <button
                      type="button"
                      aria-label={t("home.collections.rename_aria", { name: collection.name })}
                      className="px-1.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        setEditingId(collection.id);
                        setEditingName(collection.name);
                      }}
                    >
                      {t("home.collections.rename")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("home.collections.delete_aria", { name: collection.name })}
                      className="px-1.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                      onClick={() => onDelete(collection.id)}
                    >
                      {t("home.collections.delete")}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canSave && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name);
            setName("");
          }}
        >
          <span className="text-[11px] text-muted-foreground">{t("home.collections.save")}</span>
          <label htmlFor="home-collection-name" className="sr-only">
            {t("home.collections.name_placeholder")}
          </label>
          <Input
            id="home-collection-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("home.collections.name_placeholder")}
            className="h-8 max-w-[12rem] text-xs"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!name.trim() || draftTags.length === 0}>
            {t("home.collections.create")}
          </Button>
        </form>
      )}
    </section>
  );
}
