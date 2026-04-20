// Three quick toggles: preview pane, zen mode, and (handled in SettingsMenu) pagination.
// Pagination toggle lives in Settings menu; this file only exposes Preview + Zen.
import { Eye, EyeOff, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ViewControlsProps {
  showPreview: boolean;
  onTogglePreview: () => void;
  zen: boolean;
  onToggleZen: () => void;
}

export function ViewControls({ showPreview, onTogglePreview, zen, onToggleZen }: ViewControlsProps) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onTogglePreview}
            aria-label={showPreview ? "Ẩn preview" : "Hiện preview"}
          >
            {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {showPreview ? "Ẩn preview Markdown" : "Hiện preview Markdown"} (⌘⇧V)
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleZen}
            aria-label={zen ? "Tắt Zen" : "Bật Zen"}
          >
            {zen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {zen ? "Thoát chế độ Zen" : "Bật chế độ Zen — ẩn topbar khi không di chuột"} (F11)
        </TooltipContent>
      </Tooltip>
    </>
  );
}
