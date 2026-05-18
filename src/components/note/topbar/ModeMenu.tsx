// Mode dropdown: Zen, Typewriter, Focus line, Page mode, Vim mode + E-ink radio group.
import {
  AlignVerticalJustifyCenter,
  BookOpen,
  ChevronDown,
  Highlighter,
  Maximize2,
  MonitorSmartphone,
  Terminal,
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
import { useVimMode } from "@/hooks/use-vim-mode";

interface ModeMenuProps {
  zen: boolean;
  onToggleZen: () => void;
  typewriter: boolean;
  onToggleTypewriter: () => void;
  focusLine: boolean;
  onToggleFocusLine: () => void;
  paginated: boolean;
  onTogglePagination: () => void;
}

export function ModeMenu({
  zen,
  onToggleZen,
  typewriter,
  onToggleTypewriter,
  focusLine,
  onToggleFocusLine,
  paginated,
  onTogglePagination,
}: ModeMenuProps) {
  const { pref: einkPref, setMode: setEinkMode } = useEink();
  const { vim, toggleVim } = useVimMode();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-sm font-normal">
          Mode
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={onToggleZen}>
          <Maximize2 className="h-3.5 w-3.5" />
          {zen ? "Exit Zen mode" : "Enter Zen mode"}
          <span className="ml-auto text-[10px] text-muted-foreground">F11</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleTypewriter}>
          <AlignVerticalJustifyCenter className="h-3.5 w-3.5" />
          {typewriter ? "Exit Typewriter mode" : "Enter Typewriter mode"}
          <span className="ml-auto text-[10px] text-muted-foreground">F9</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleFocusLine}>
          <Highlighter className="h-3.5 w-3.5" />
          {focusLine ? "Disable Focus line" : "Enable Focus line"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onTogglePagination}>
          <BookOpen className="h-3.5 w-3.5" />
          {paginated ? "Disable Page mode" : "Enable Page mode"}
          <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧P</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggleVim}>
          <Terminal className="h-3.5 w-3.5" />
          {vim ? "Disable Vim mode" : "Enable Vim mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 text-xs">
          <MonitorSmartphone className="h-3.5 w-3.5" />
          E-ink mode
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={einkPref}
          onValueChange={(v) => setEinkMode(v as "auto" | "on" | "off")}
        >
          <DropdownMenuRadioItem value="auto">Auto-detect</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="on">On</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
