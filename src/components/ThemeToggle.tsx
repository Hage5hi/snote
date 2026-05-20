import { forwardRef } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Icon-only theme toggle. forwardRef so Tooltip/DropdownMenu asChild parents
 * can attach refs without React warnings.
 */
export const ThemeToggle = forwardRef<HTMLButtonElement>((_props, ref) => {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="h-7 w-7"
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all duration-300 ease-out motion-reduce:transition-none dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all duration-300 ease-out motion-reduce:transition-none dark:rotate-0 dark:scale-100" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{isDark ? "Light theme" : "Dark theme"}</TooltipContent>
    </Tooltip>
  );
});

ThemeToggle.displayName = "ThemeToggle";
