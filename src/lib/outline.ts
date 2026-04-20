// Parse markdown headings while ignoring fenced code blocks.
// Handles ATX style (# Heading) only — Setext (===/---) is rare in modern notes
// and would require lookahead.

export interface Heading {
  level: number;
  text: string;
  /** 0-indexed line number — used to scroll the editor to this heading. */
  line: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function parseOutline(text: string): Heading[] {
  const out: Heading[] = [];
  if (!text) return out;
  const lines = text.split("\n");
  let inFence = false;
  let fenceMarker = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Track ``` and ~~~ fences so headings inside code blocks are ignored.
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      const m = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = m[0];
      } else if (m[0] === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;
    const match = line.match(HEADING_RE);
    if (match) {
      out.push({ level: match[1].length, text: match[2].trim(), line: i });
    }
  }
  return out;
}
