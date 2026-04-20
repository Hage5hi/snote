/**
 * Lightweight tag extraction.
 * Tags are #words appearing inline in the note. They must:
 *  - start with `#`
 *  - be preceded by start-of-string or whitespace (so `#abc` matches but
 *    `foo#bar` does not — avoids URL fragments and CSS colors)
 *  - contain only letters, numbers, `-` and `_`, length 1..32
 *  - NOT be inside a fenced ```code``` block
 */

const TAG_RE = /(?:^|[\s(\[{])#([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF-]{1,32})/g;

export function extractTags(content: string): string[] {
  if (!content) return [];

  // Strip fenced code blocks so #include in C code etc. doesn't leak in.
  const stripped = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

  const set = new Set<string>();
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(stripped))) {
    const tag = m[1].toLowerCase();
    // Skip pure-numeric (likely heading anchor or issue number).
    if (/^\d+$/.test(tag)) continue;
    set.add(tag);
    if (set.size >= 20) break; // hard cap
  }
  return [...set].sort();
}

export function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
