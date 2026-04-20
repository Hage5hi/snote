// Word/char counter on the Topbar. Click to open the WordGoalDialog.
// When a goal is set, shows progress (count / goal + thin bar).
import { Target } from "lucide-react";
import { useWordGoal } from "@/hooks/use-word-goal";

interface WordCountTriggerProps {
  slug: string;
  words: number;
  chars: number;
  onOpen: () => void;
}

export function WordCountTrigger({ slug, words, chars, onOpen }: WordCountTriggerProps) {
  const { goal } = useWordGoal(slug);
  const goalPct = goal && goal > 0 ? Math.min(100, Math.round((words / goal) * 100)) : 0;
  const goalReached = goal != null && words >= goal;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="hidden sm:flex items-center gap-3 rounded-md px-2 py-1 text-[11px] text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground"
      title={goal ? `Mục tiêu: ${goal.toLocaleString()} từ — ${goalPct}%` : "Đặt mục tiêu số từ"}
    >
      {goal ? (
        <>
          <span className="flex items-center gap-1.5">
            <Target className={`h-3 w-3 ${goalReached ? "text-primary" : ""}`} />
            <span className={goalReached ? "text-primary font-medium" : ""}>
              {words} / {goal}
            </span>
          </span>
          <span
            className="relative h-1 w-16 overflow-hidden rounded-full bg-muted"
            aria-hidden
          >
            <span
              className={`absolute inset-y-0 left-0 transition-all ${
                goalReached ? "bg-primary" : "bg-foreground/60"
              }`}
              style={{ width: `${goalPct}%` }}
            />
          </span>
        </>
      ) : (
        <>
          <span>{words} words</span>
          <span>{chars} chars</span>
        </>
      )}
    </button>
  );
}
