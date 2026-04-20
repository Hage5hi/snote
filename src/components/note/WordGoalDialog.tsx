import { useEffect, useState } from "react";
import { Target, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useWordGoal } from "@/hooks/use-word-goal";
import { toast } from "@/hooks/use-toast";

interface WordGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  currentWords: number;
}

const PRESETS = [250, 500, 1000, 2000];

/**
 * Set/clear a word count goal for the current note. Stored in localStorage
 * per slug so each note can track a different target (essay vs journal etc.).
 */
export function WordGoalDialog({ open, onOpenChange, slug, currentWords }: WordGoalDialogProps) {
  const { goal, setGoal } = useWordGoal(slug);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue(goal ? String(goal) : "");
  }, [open, goal]);

  const parsed = parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000;

  const onSave = () => {
    if (!valid) return;
    setGoal(parsed);
    toast({
      title: "Đã đặt mục tiêu",
      description: `${parsed.toLocaleString()} từ cho /${slug}`,
    });
    onOpenChange(false);
  };

  const onClear = () => {
    setGoal(null);
    toast({ title: "Đã xoá mục tiêu" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Mục tiêu số từ
          </DialogTitle>
          <DialogDescription>
            Đặt số từ mục tiêu cho <code className="font-mono">/{slug}</code>. Hiển thị progress
            bar trên Topbar và toast chúc mừng khi đạt mốc.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            autoFocus
            type="number"
            min={1}
            max={1_000_000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) {
                e.preventDefault();
                onSave();
              }
            }}
            placeholder="vd: 500"
            className="font-mono"
          />

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((n) => (
              <Button
                key={n}
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setValue(String(n))}
              >
                {n.toLocaleString()}
              </Button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Hiện tại: <span className="tabular-nums text-foreground">{currentWords}</span> từ
            {goal && (
              <>
                {" · "}
                Mục tiêu cũ:{" "}
                <span className="tabular-nums text-foreground">{goal.toLocaleString()}</span>
              </>
            )}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={onClear}
            disabled={!goal}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Xoá mục tiêu
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Huỷ
            </Button>
            <Button onClick={onSave} disabled={!valid}>
              Lưu
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
