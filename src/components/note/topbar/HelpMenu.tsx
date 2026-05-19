// Help dropdown: keyboard shortcuts + Split view hint.
import { ChevronDown, Keyboard, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";

interface HelpMenuProps {
  onOpenShortcuts: () => void;
}

export function HelpMenu({ onOpenShortcuts }: HelpMenuProps) {
  const { t } = useI18n();
  // Split the localized "Open URL {code} ..." string around the {code} placeholder
  // so we can render the slug as a styled <code> element.
  const splitHint = t("help.split_hint", { code: "§§CODE§§" }).split("§§CODE§§");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-sm font-normal">
          {t("menu.help")}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={onOpenShortcuts}>
          <Keyboard className="h-3.5 w-3.5" /> {t("help.shortcuts")}
          <span className="ml-auto text-[10px] text-muted-foreground">?</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 text-xs">
          <Link2 className="h-3.5 w-3.5" />
          {t("help.split_label")}
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="text-xs text-muted-foreground"
          onSelect={(e) => e.preventDefault()}
        >
          {splitHint[0]}
          <code className="mx-1 font-mono">/a+b</code>
          {splitHint[1] ?? ""}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
