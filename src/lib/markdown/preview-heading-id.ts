const PREFIX = "preview-h-";
const RESERVED_IDS = new Set(["owner", "edit", "key"]);

function slugifyPreviewHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[`*_~#[\]()]+/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function createPreviewHeadingIds(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const slug = slugifyPreviewHeading(text);
    // Prefix is the real collision guard vs capability hashes `#owner`/`#edit`/`#key`.
    let id = `${PREFIX}${slug || "section"}`;
    if (RESERVED_IDS.has(id)) id = `${PREFIX}heading`;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n === 0 ? id : `${id}-${n}`;
  };
}
