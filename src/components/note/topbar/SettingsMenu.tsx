// Settings dropdown: e-ink mode, zen, pagination, rename, duplicate, word goal, split view hint.
import {
  AlignVerticalJustifyCenter,
  BookOpen,
  CopyPlus,
  Link2,
  MonitorSmartphone,
  Pencil,
  Settings2,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEink } from "@/hooks/use-eink";
import { useWordGoal } from "@/hooks/use-word-goal";

interface SettingsMenuProps {
  slug: string;
  zen: boolean;
  onToggleZen: () => void;
  typewriter: boolean;
  onToggleTypewriter: () => void;
  paginated: boolean;
  onTogglePagination: () => void;
  onOpenRename: () => void;
  onOpenDuplicate: () => void;
  onOpenGoal: () => void;
}

export function SettingsMenu({
  slug,
  zen,
  onToggleZen,
  typewriter,
  onToggleTypewriter,
  paginated,
  onTogglePagination,
  onOpenRename,
  onOpenDuplicate,
  onOpenGoal,
}: SettingsMenuProps) {
  const { pref: einkPref, setMode: setEinkMode } = useEink();
  const { goal } = useWordGoal(slug);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Cài đặt">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2 text-xs">
          <MonitorSmartphone className="h-3.5 w-3.5" />
          E-ink mode
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={einkPref}
          onValueChange={(v) => setEinkMode(v as "auto" | "on" | "off")}
        >
          <DropdownMenuRadioItem value="auto">Auto-detect</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="on">Bật</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off">Tắt</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onToggleZen}>
          {zen ? "Tắt Zen mode" : "Bật Zen mode"}
          <span className="ml-auto text-[10px] text-muted-foreground">F11</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleTypewriter}>
          <AlignVerticalJustifyCenter className="h-3.5 w-3.5" />
          {typewriter ? "Tắt Typewriter mode" : "Bật Typewriter mode"}
          <span className="ml-auto text-[10px] text-muted-foreground">F9</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onTogglePagination}>
          <BookOpen className="h-3.5 w-3.5" />
          {paginated ? "Tắt Lật trang" : "Bật Lật trang"}
          <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧P</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenRename}>
          <Pencil className="h-3.5 w-3.5" />
          Đổi tên slug...
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenDuplicate}>
          <CopyPlus className="h-3.5 w-3.5" />
          Duplicate note...
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenGoal}>
          <Target className="h-3.5 w-3.5" />
          {goal ? `Mục tiêu: ${goal.toLocaleString()} từ` : "Đặt mục tiêu số từ..."}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 text-xs">
          <Link2 className="h-3.5 w-3.5" />
          Split view
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="text-xs text-muted-foreground"
          onSelect={(e) => e.preventDefault()}
        >
          Mở URL <code className="mx-1 font-mono">/a+b</code> để xem 2 note cạnh nhau.
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
