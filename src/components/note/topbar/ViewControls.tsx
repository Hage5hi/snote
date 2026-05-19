// Two quick toggles kept as icons: preview pane and scroll sync (only when preview is on).
// Zen mode moved to Mode menu.
import { Eye, EyeOff, Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/index";

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
  const { t } = useI18n();
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onTogglePreview}
            aria-label={showPreview ? t("view.aria_hide_preview") : t("view.aria_show_preview")}
          >
            {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {showPreview ? t("view.tooltip_hide_preview") : t("view.tooltip_show_preview")} (⌘⇧V)
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
              aria-label={scrollSync ? t("view.aria_scroll_off") : t("view.aria_scroll_on")}
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
            {scrollSync ? t("view.tooltip_scroll_off") : t("view.tooltip_scroll_on")}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
