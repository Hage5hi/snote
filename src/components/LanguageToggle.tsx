// Compact language switcher between Vietnamese and English.
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  const next = lang === "vi" ? "en" : "vi";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs font-medium"
          onClick={() => setLang(next)}
          aria-label={t("lang.label")}
        >
          <Languages className="h-3.5 w-3.5" />
          <span className="uppercase">{lang}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t("lang.toggle")}</TooltipContent>
    </Tooltip>
  );
}
