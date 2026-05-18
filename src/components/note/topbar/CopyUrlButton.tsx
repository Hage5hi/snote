// Quick icon to copy the current note URL (window.location.href).
import { Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";

export function CopyUrlButton() {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Đã copy URL note" });
    } catch {
      toast({ title: "Không thể copy URL", variant: "destructive" });
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={copy}
          aria-label="Copy URL note"
        >
          <Link className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Copy URL note hiện tại</TooltipContent>
    </Tooltip>
  );
}
