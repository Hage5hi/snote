import { forwardRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSceneTheme } from "@/hooks/use-scene-theme";
import { SCENE_NONE, SCENE_REGISTRY } from "@/components/home/scenes/registry";
import { useI18n } from "@/i18n";

/**
 * SceneToggle — Home-only picker for the optional animated background scene.
 *
 * Renders a small Sparkles icon button beside the language toggle. Selecting a
 * scene that opts into a forced color scheme pins next-themes accordingly
 * (same behaviour the old combined ThemeToggle had).
 */
export const SceneToggle = forwardRef<HTMLButtonElement>((_props, ref) => {
  const { setTheme } = useTheme();
  const { scene, setScene } = useSceneTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const select = (id: string) => {
    if (id === SCENE_NONE) {
      setScene(SCENE_NONE);
      return;
    }
    const def = SCENE_REGISTRY.find((s) => s.id === id);
    if (!def || !def.enabled) return;
    if (def.forceColorScheme) setTheme(def.forceColorScheme);
    setScene(def.id);
  };

  const entries = SCENE_REGISTRY.filter((e) => e.id !== SCENE_NONE);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t("scene.toggle.aria")}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("theme.scene.label")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={scene} onValueChange={select}>
          {entries.map((e) => {
            const label = t(e.labelKey as Parameters<typeof t>[0]);
            return (
              <DropdownMenuRadioItem
                key={e.id}
                value={e.id}
                disabled={!e.enabled}
                aria-label={label}
                className="gap-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-6 shrink-0 rounded-sm ring-1 ring-border"
                  style={{
                    background: `linear-gradient(135deg, ${e.swatch[0]}, ${e.swatch[1]})`,
                  }}
                />
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm">
                  {label}
                  {!e.enabled && (
                    <span className="ml-1 rounded bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                      {t("scene.coming_soon")}
                    </span>
                  )}
                </span>
                {scene === e.id && e.enabled && (
                  <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                )}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});


SceneToggle.displayName = "SceneToggle";
