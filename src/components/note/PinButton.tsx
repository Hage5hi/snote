import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isPinned, togglePin } from "@/lib/recent-notes";
import { toast } from "@/hooks/use-toast";

interface PinButtonProps {
  slug: string;
}

/**
 * Star/pin the current note so it sticks to the top of Cmd+K palette.
 * State lives in localStorage (see recent-notes.ts), so we re-read on mount
 * and after each toggle to stay in sync with other tabs/components.
 */
export function PinButton({ slug }: PinButtonProps) {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    setPinned(isPinned(slug));
  }, [slug]);

  // Keep in sync if Cmd+K toggles pin from another component.
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
      title: nowPinned ? "Đã pin note" : "Đã bỏ pin",
      description: nowPinned
        ? "Note này sẽ hiện ở đầu Cmd+K palette."
        : `/${slug} đã bỏ khỏi danh sách pin.`,
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
          aria-label={pinned ? "Bỏ pin" : "Pin note"}
        >
          <Star
            className={`h-4 w-4 transition-colors ${
              pinned ? "fill-primary text-primary" : "text-muted-foreground"
            }`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{pinned ? "Bỏ pin" : "Pin note (hiện ở đầu Cmd+K)"}</TooltipContent>
    </Tooltip>
  );
}
