import { forwardRef } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useSceneTheme } from "@/hooks/use-scene-theme";
import { SCENE_NONE } from "@/components/home/scenes/registry";
import { useI18n } from "@/i18n";

// Direct light/dark toggle. Clicking flips the theme immediately — no menu,
// no "system" option. Any active scene is cleared so the explicit choice wins.
export const ThemeToggle = forwardRef<HTMLButtonElement>((_props, ref) => {
  const { resolvedTheme, setTheme } = useTheme();
  const { setScene } = useSceneTheme();
  const { t } = useI18n();

  const toggle = () => {
    setScene(SCENE_NONE);
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      aria-label={t("theme.aria")}
      onClick={toggle}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all duration-300 ease-out motion-reduce:transition-none dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all duration-300 ease-out motion-reduce:transition-none dark:rotate-0 dark:scale-100" />
    </Button>
  );
});

ThemeToggle.displayName = "ThemeToggle";
