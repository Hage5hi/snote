import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isPinned, togglePin } from "@/lib/recent-notes";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/index";

interface PinButtonProps {
  slug: string;
}

export function PinButton({ slug }: PinButtonProps) {
  const { t } = useI18n();
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    setPinned(isPinned(slug));
  }, [slug]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "note.pinned") setPinned(isPinned(slug));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [slug]);

  const onClick = () => {
    const next = togglePin(slug);
    const nowPinned = next.includes(slug);
    setPinned(nowPinned);
    toast({
      title: nowPinned ? t("pin.toast_pinned") : t("pin.toast_unpinned"),
      description: nowPinned ? t("pin.desc_pinned") : t("pin.desc_unpinned", { slug }),
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClick}
          aria-label={pinned ? t("pin.aria_unpin") : t("pin.aria_pin")}
        >
          <Star
            className={`h-4 w-4 transition-colors ${
              pinned ? "fill-primary text-primary" : "text-muted-foreground"
            }`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {pinned ? t("pin.tooltip_unpin") : t("pin.tooltip_pin")}
      </TooltipContent>
    </Tooltip>
  );
}
