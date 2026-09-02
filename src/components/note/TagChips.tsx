import { useEffect, useState } from "react";
import * as Y from "yjs";
import { extractTags } from "@/lib/tags";
import { useI18n } from "@/i18n/index";
import { openCommandPalette } from "@/lib/cmdk-open";


interface TagChipsProps {
  doc: Y.Doc;
  isEncrypted: boolean;
}

/**
 * Live tag chips derived from the document's plaintext content. Hidden when
 * the note is encrypted (server is zero-knowledge — tags are not extracted)
 * or when there are no tags yet.
 *
 * Clicking a chip opens the command palette filtered to `#tag` on this device.
 * Live admin is off — never route to `/note#tag=`.
 */
export function TagChips({ doc, isEncrypted }: TagChipsProps) {
  const { t } = useI18n();
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (isEncrypted) {
      setTags([]);
      return;
    }
    const ytext = doc.getText("content");
    let raf = 0;
    const update = () => {
      // rAF debounce — tag extraction does a regex scan + string strip.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTags(extractTags(ytext.toString())));
    };
    update();
    ytext.observe(update);
    return () => {
      cancelAnimationFrame(raf);
      ytext.unobserve(update);
    };
  }, [doc, isEncrypted]);

  if (isEncrypted || tags.length === 0) return null;

  return (
    <div className="hidden md:flex items-center gap-1 overflow-hidden">
      {tags.slice(0, 5).map((tag) => (
        <button
          key={tag}
          type="button"
          title={t("tag.open_filter", { tag })}
          onClick={() => openCommandPalette(`#${tag}`)}
          className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          #{tag}
        </button>
      ))}
      {tags.length > 5 && (
        <span className="text-[10px] text-muted-foreground" title={tags.slice(5).join(", ")}>
          +{tags.length - 5}
        </span>
      )}
    </div>
  );
}
