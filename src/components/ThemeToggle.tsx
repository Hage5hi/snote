import { forwardRef, useState } from "react";
import { Check, Moon, Palette, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSceneTheme } from "@/hooks/use-scene-theme";
import { SCENE_REGISTRY } from "@/components/home/scenes/registry";
import { useI18n } from "@/i18n";

/**
 * Two-axis theme picker:
 *  - Color scheme (light / dark / system) via next-themes
 *  - Background scene (none / cyber-linh-khi / ...) via useSceneTheme
 *
 * The Scene section only renders on `/` to keep the menu compact elsewhere.
 */
export const ThemeToggle = forwardRef<HTMLButtonElement>((_props, ref) => {
  const { theme, setTheme } = useTheme();
  const { scene, setScene } = useSceneTheme();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const isHome = pathname === "/";

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
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("theme.color.label")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" className="gap-2">
            <Sun className="h-3.5 w-3.5" />
            <span>{t("theme.color.light")}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="gap-2">
            <Moon className="h-3.5 w-3.5" />
            <span>{t("theme.color.dark")}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="gap-2">
            <SunMoon className="h-3.5 w-3.5" />
            <span>{t("theme.color.system")}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        {isHome && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Palette className="h-3 w-3" />
              {t("theme.scene.label")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={scene} onValueChange={setScene}>
              {SCENE_REGISTRY.map((def) => {
                const label = t(def.labelKey);
                const desc = def.descKey ? t(def.descKey) : "";
                return (
                  <DropdownMenuRadioItem
                    key={def.id}
                    value={def.id}
                    disabled={!def.enabled}
                    className="gap-2"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-3.5 w-6 shrink-0 rounded-sm ring-1 ring-border"
                      style={{
                        background: `linear-gradient(135deg, ${def.swatch[0]}, ${def.swatch[1]})`,
                      }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1 truncate text-sm">
                        {label}
                        {!def.enabled && (
                          <span className="ml-1 rounded bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                            {t("scene.coming_soon")}
                          </span>
                        )}
                      </span>
                      {desc && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {desc}
                        </span>
                      )}
                    </span>
                    {scene === def.id && def.enabled && (
                      <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                    )}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

ThemeToggle.displayName = "ThemeToggle";
