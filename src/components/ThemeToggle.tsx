import { forwardRef, useState } from "react";
import { Check, Moon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { useLocation } from "react-router-dom";
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
import { SCENE_NONE, SCENE_REGISTRY } from "@/components/home/scenes/registry";
import { useI18n } from "@/i18n";

// --- Single-axis Theme model -------------------------------------------------
//
// One list, one selected value. Color-scheme entries (light/dark/system)
// implicitly disable any active scene. Scene entries can force a color
// scheme (cyber* themes pin dark so the editor at /:slug stays comfortable
// when the user navigates away).
//
// Entries with `enabled: false` render as disabled "Soon" rows.

type ColorEntry = {
  kind: "color";
  id: "light" | "dark" | "system";
  labelKey: string;
  icon: typeof Sun;
};

type SceneEntry = {
  kind: "scene";
  id: string;
  labelKey: string;
  descKey?: string;
  swatch: [string, string];
  enabled: boolean;
  /** When selected, force next-themes to this scheme. */
  forceColorScheme?: "light" | "dark";
};

const COLOR_ENTRIES: ColorEntry[] = [
  { kind: "color", id: "light", labelKey: "theme.color.light", icon: Sun },
  { kind: "color", id: "dark", labelKey: "theme.color.dark", icon: Moon },
  { kind: "color", id: "system", labelKey: "theme.color.system", icon: SunMoon },
];

const SCENE_ENTRIES: SceneEntry[] = SCENE_REGISTRY
  .filter((s) => s.id !== SCENE_NONE)
  .map((s) => ({
    kind: "scene",
    id: s.id,
    labelKey: s.labelKey,
    descKey: s.descKey,
    swatch: s.swatch,
    enabled: s.enabled,
    // All cyber-style scenes assume dark; current registry items are dark.
    forceColorScheme: "dark",
  }));

export const ThemeToggle = forwardRef<HTMLButtonElement>((_props, ref) => {
  const { theme, setTheme } = useTheme();
  const { scene, setScene } = useSceneTheme();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const isHome = pathname === "/";

  // Active id = scene (when non-none) else color theme.
  const activeId =
    scene && scene !== SCENE_NONE ? scene : (theme ?? "system");

  const select = (id: string) => {
    const color = COLOR_ENTRIES.find((c) => c.id === id);
    if (color) {
      setScene(SCENE_NONE);
      setTheme(color.id);
      return;
    }
    const sceneEntry = SCENE_ENTRIES.find((s) => s.id === id);
    if (sceneEntry && sceneEntry.enabled) {
      if (sceneEntry.forceColorScheme) setTheme(sceneEntry.forceColorScheme);
      setScene(sceneEntry.id);
    }
  };

  // Outside Home we only show color entries — scenes are Home-only.
  const entries: Array<ColorEntry | SceneEntry> = isHome
    ? [...COLOR_ENTRIES, ...SCENE_ENTRIES]
    : COLOR_ENTRIES;

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
        <DropdownMenuRadioGroup value={activeId} onValueChange={select}>
          {entries.map((e) => {
            const label = t(e.labelKey as Parameters<typeof t>[0]);
            if (e.kind === "color") {
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
                  {activeId === e.id && (
                    <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                  )}
                </DropdownMenuRadioItem>
              );
            }
            const desc = e.descKey ? t(e.descKey as Parameters<typeof t>[0]) : "";
            return (
              <DropdownMenuRadioItem
                key={e.id}
                value={e.id}
                disabled={!e.enabled}
                aria-label={desc ? `${label} — ${desc}` : label}
                className="gap-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-6 shrink-0 rounded-sm ring-1 ring-border"
                  style={{
                    background: `linear-gradient(135deg, ${e.swatch[0]}, ${e.swatch[1]})`,
                  }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1 truncate text-sm">
                    {label}
                    {!e.enabled && (
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
                {activeId === e.id && e.enabled && (
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

ThemeToggle.displayName = "ThemeToggle";
