import { forwardRef } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * forwardRef wrapper — some parents (Tooltip, DropdownMenu asChild) pass
 * refs through. Without forwardRef React logs a noisy warning even when
 * the ref is unused.
 */
export const ThemeToggle = forwardRef<HTMLButtonElement>((_props, ref) => {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="text-sidebar-foreground hover:bg-sidebar-accent h-7 w-full justify-start gap-2 px-2 text-[12px]"
    >
      <Sun className="h-3.5 w-3.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-3.5 w-3.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 ml-0" />
      <span className="dark:ml-5">Theme</span>
    </Button>
  );
});

ThemeToggle.displayName = "ThemeToggle";
