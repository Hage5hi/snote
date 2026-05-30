// Shortcuts trigger: a single button that opens the Keyboard shortcuts & tips dialog.
// (Previously a Help dropdown that wrapped the same action plus a Split-view hint —
//  the hint is already covered inside the dialog, so the dropdown was redundant.)
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";

interface HelpMenuProps {
  onOpenShortcuts: () => void;
}

export function HelpMenu({ onOpenShortcuts }: HelpMenuProps) {
  const { t } = useI18n();
  const label = t("shortcuts.title");
  const longLabel = t("help.shortcuts");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-sm font-normal"
          onClick={onOpenShortcuts}
          aria-label={longLabel}
        >
          <Keyboard className="h-3.5 w-3.5 opacity-70" />
          <span className="hidden sm:inline">{label}</span>
          <span className="ml-0.5 hidden text-[10px] text-muted-foreground sm:inline">?</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{longLabel}</TooltipContent>
    </Tooltip>
  );
}
