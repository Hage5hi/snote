interface WordCountPillProps {
  words: number;
  chars: number;
}

/**
 * Floating bottom-left pill: word count, char count, and reading-time estimate.
 * Hidden on small screens to save space (Topbar already shows the same on sm+).
 */
export function WordCountPill({ words, chars }: WordCountPillProps) {
  // 200 wpm reading speed — common average for prose. Round up to nearest minute.
  const minutes = Math.max(1, Math.ceil(words / 200));
  const readLabel = words === 0 ? "—" : `${minutes} phút đọc`;

  return (
    <div
      className="zen-hide pointer-events-none fixed bottom-4 left-4 z-30 hidden items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur tabular-nums sm:flex"
      role="status"
      aria-live="polite"
    >
      <span>{words} words</span>
      <span className="opacity-40">·</span>
      <span>{chars} chars</span>
      <span className="opacity-40">·</span>
      <span>{readLabel}</span>
    </div>
  );
}
