// Note dropdown: rename, duplicate, word goal, history, copy entire note.
import { ChevronDown, ClipboardCopy, CopyPlus, History, Pencil, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NoteMenuProps {
  onOpenRename: () => void;
  onOpenDuplicate: () => void;
  onOpenGoal: () => void;
  onOpenHistory: () => void;
  onCopyAll: () => void;
}

export function NoteMenu({
  onOpenRename,
  onOpenDuplicate,
  onOpenGoal,
  onOpenHistory,
  onCopyAll,
}: NoteMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-sm font-normal">
          Note
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onOpenRename}>
          <Pencil className="h-3.5 w-3.5" /> Rename slug…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenDuplicate}>
          <CopyPlus className="h-3.5 w-3.5" /> Duplicate note…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenGoal}>
          <Target className="h-3.5 w-3.5" /> Set word goal…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenHistory}>
          <History className="h-3.5 w-3.5" /> History &amp; Restore
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCopyAll}>
          <ClipboardCopy className="h-3.5 w-3.5" /> Copy entire note
          <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧C</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
