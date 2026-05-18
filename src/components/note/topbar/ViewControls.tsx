// Two quick toggles kept as icons: preview pane and scroll sync (only when preview is on).
// Zen mode moved to Mode menu.
import { Eye, EyeOff, Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ViewControlsProps {
  showPreview: boolean;
  onTogglePreview: () => void;
  scrollSync: boolean;
  onToggleScrollSync: () => void;
}

export function ViewControls({
  showPreview,
  onTogglePreview,
  scrollSync,
  onToggleScrollSync,
}: ViewControlsProps) {
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

      {showPreview && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onToggleScrollSync}
              aria-label={scrollSync ? "Tắt scroll sync" : "Bật scroll sync"}
              aria-pressed={scrollSync}
            >
              {scrollSync ? (
                <Link2 className="h-4 w-4" />
              ) : (
                <Link2Off className="h-4 w-4 opacity-60" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {scrollSync
              ? "Tắt đồng bộ cuộn editor ↔ preview"
              : "Bật đồng bộ cuộn editor ↔ preview"}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
