// Note dropdown: word goal, history, copy entire note.
import { ChevronDown, ClipboardCopy, History, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";

interface NoteMenuProps {
  onOpenGoal: () => void;
  onOpenHistory: () => void;
  onCopyAll: () => void;
}

export function NoteMenu({ onOpenGoal, onOpenHistory, onCopyAll }: NoteMenuProps) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-sm font-normal">
          {t("menu.note")}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onOpenGoal}>
          <Target className="h-3.5 w-3.5" /> {t("note.goal")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenHistory}>
          <History className="h-3.5 w-3.5" /> {t("note.history")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCopyAll}>
          <ClipboardCopy className="h-3.5 w-3.5" /> {t("note.copy_all")}
          <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧C</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
