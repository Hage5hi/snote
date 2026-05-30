// Language switcher: dropdown listing all supported languages.
// Uses SVG flags (Flag component) so countries render consistently across
// Windows/Linux/macOS/iOS/Android — Windows has no native flag emoji font.
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Flag } from "@/components/Flag";
import { LANG_NAMES, SUPPORTED_LANGS, useI18n, type Lang } from "@/i18n";

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs font-medium"
              aria-label={t("lang.label")}
            >
              <Flag lang={lang} size={18} />
              <span className="uppercase">{lang}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("lang.choose")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("lang.label")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LANGS.map((l: Lang) => (
          <DropdownMenuItem
            key={l}
            onClick={() => setLang(l)}
            className="flex items-center gap-2.5"
          >
            <Flag lang={l} size={20} />
            <span>{LANG_NAMES[l].native}</span>
            {lang === l && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
