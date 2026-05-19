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
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onClick={onToggleZen} className="items-start py-2">
          <Maximize2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span>{zen ? "Exit Zen mode" : "Enter Zen mode"}</span>
            <span className="text-[11px] text-muted-foreground">Ẩn toolbar/sidebar, chỉ còn vùng soạn thảo</span>
          </div>
          <span className="ml-auto self-start text-[10px] text-muted-foreground">F11</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleTypewriter} className="items-start py-2">
          <AlignVerticalJustifyCenter className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span>{typewriter ? "Exit Typewriter mode" : "Enter Typewriter mode"}</span>
            <span className="text-[11px] text-muted-foreground">Giữ dòng đang gõ luôn ở giữa màn hình</span>
          </div>
          <span className="ml-auto self-start text-[10px] text-muted-foreground">F9</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleFocusLine} className="items-start py-2">
          <Highlighter className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span>{focusLine ? "Disable Focus line" : "Enable Focus line"}</span>
            <span className="text-[11px] text-muted-foreground">Làm mờ các dòng khác, chỉ nổi bật dòng đang gõ</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onTogglePagination} className="items-start py-2">
          <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span>{paginated ? "Disable Page mode" : "Enable Page mode"}</span>
            <span className="text-[11px] text-muted-foreground">Chia nội dung thành từng trang như sách/A4</span>
          </div>
          <span className="ml-auto self-start text-[10px] text-muted-foreground">⌘⇧P</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggleVim} className="items-start py-2">
          <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span>{vim ? "Disable Vim mode" : "Enable Vim mode"}</span>
            <span className="text-[11px] text-muted-foreground">Phím tắt kiểu Vim (hjkl, i, esc…) trong editor</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex flex-col gap-0.5 text-xs">
          <span className="flex items-center gap-2">
            <MonitorSmartphone className="h-3.5 w-3.5" />
            E-ink mode
          </span>
          <span className="pl-5 text-[11px] font-normal text-muted-foreground">Tắt animation, tăng tương phản cho máy đọc sách</span>
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
