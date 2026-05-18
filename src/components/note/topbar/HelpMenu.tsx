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

interface HelpMenuProps {
  onOpenShortcuts: () => void;
}

export function HelpMenu({ onOpenShortcuts }: HelpMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-sm font-normal">
          Help
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={onOpenShortcuts}>
          <Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts &amp; tips
          <span className="ml-auto text-[10px] text-muted-foreground">?</span>
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
          Open URL <code className="mx-1 font-mono">/a+b</code> to view two notes side by side.
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
