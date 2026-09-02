import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function HomeTagFilter({
  value,
  onChange,
  knownTags,
}: {
  value: string;
  onChange: (value: string) => void;
  knownTags: string[];
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <label htmlFor="home-tag-filter" className="sr-only">
        {t("home.filter.aria")}
      </label>
      <div className="relative">
        <Input
          id="home-tag-filter"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("home.filter.placeholder")}
          className="h-9 font-mono text-sm"
          aria-label={t("home.filter.aria")}
        />
        {value.trim() !== "" && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => onChange("")}
          >
            {t("home.filter.clear")}
          </button>
        )}
      </div>
      {knownTags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("home.filter.label")}>
          {knownTags.map((tag) => {
            const selected = value.trim().toLowerCase() === `#${tag}`
              || value.trim().toLowerCase().split(/\s+/).includes(`#${tag}`);
            return (
              <li key={tag}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={t("home.filter.chip_aria", { tag })}
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-mono text-[11px]",
                    selected
                      ? "border-foreground/30 bg-accent text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  onClick={() => onChange(selected && value.trim().toLowerCase() === `#${tag}` ? "" : `#${tag}`)}
                >
                  #{tag}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
