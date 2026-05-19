import { useI18n } from "@/i18n/index";

interface WordCountPillProps {
  words: number;
  chars: number;
  goal?: number | null;
}

export function WordCountPill({ words, chars, goal }: WordCountPillProps) {
  const { t } = useI18n();
  const minutes = Math.max(1, Math.ceil(words / 200));
  const readLabel = words === 0 ? t("wc.dash") : t("wc.reading_min", { n: minutes });
  const hasGoal = goal && goal > 0;
  const pct = hasGoal ? Math.min(100, Math.round((words / goal) * 100)) : 0;
  const reached = hasGoal && words >= goal;

  return (
    <div
      className="zen-hide pointer-events-none fixed bottom-4 left-4 z-30 hidden items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur tabular-nums sm:flex"
      role="status"
      aria-live="polite"
    >
      {hasGoal ? (
        <>
          <span className={reached ? "text-primary" : "text-foreground"}>
            {words} / {goal} words
          </span>
          <span className="opacity-40">·</span>
          <span>{pct}%</span>
        </>
      ) : (
        <>
          <span>{words} words</span>
          <span className="opacity-40">·</span>
          <span>{chars} chars</span>
        </>
      )}
      <span className="opacity-40">·</span>
      <span>{readLabel}</span>
    </div>
  );
}
