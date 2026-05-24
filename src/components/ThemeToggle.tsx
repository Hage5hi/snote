import { forwardRef, useState } from "react";
import { Check, Moon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSceneTheme } from "@/hooks/use-scene-theme";
import { SCENE_NONE } from "@/components/home/scenes/registry";
import { useI18n } from "@/i18n";

// Color-scheme-only toggle. Scene selection lives in SceneToggle (Home only).
// Selecting a colour scheme implicitly clears any active scene so the user's
// explicit choice always wins.

type ColorId = "light" | "dark" | "system";

const COLOR_ENTRIES: { id: ColorId; labelKey: string; icon: typeof Sun }[] = [
  { id: "light", labelKey: "theme.color.light", icon: Sun },
  { id: "dark", labelKey: "theme.color.dark", icon: Moon },
  { id: "system", labelKey: "theme.color.system", icon: SunMoon },
];

export const ThemeToggle = forwardRef<HTMLButtonElement>((_props, ref) => {
  const { theme, setTheme } = useTheme();
  const { setScene } = useSceneTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const select = (id: string) => {
    const entry = COLOR_ENTRIES.find((c) => c.id === id);
    if (!entry) return;
    setScene(SCENE_NONE);
    setTheme(entry.id);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t("theme.aria")}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all duration-300 ease-out motion-reduce:transition-none dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all duration-300 ease-out motion-reduce:transition-none dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("theme.color.label")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={select}>
          {COLOR_ENTRIES.map((e) => {
            const label = t(e.labelKey as Parameters<typeof t>[0]);
            const Icon = e.icon;
            return (
              <DropdownMenuRadioItem
                key={e.id}
                value={e.id}
                aria-label={label}
                className="gap-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="flex-1 text-sm">{label}</span>
                {theme === e.id && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

ThemeToggle.displayName = "ThemeToggle";
