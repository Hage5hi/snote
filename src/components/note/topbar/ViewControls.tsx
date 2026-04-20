// Three quick toggles: preview pane, zen mode, and (handled in SettingsMenu) pagination.
// Pagination toggle lives in Settings menu; this file only exposes Preview + Zen.
import { Eye, EyeOff, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ViewControlsProps {
  showPreview: boolean;
  onTogglePreview: () => void;
  zen: boolean;
  onToggleZen: () => void;
}

export function ViewControls({ showPreview, onTogglePreview, zen, onToggleZen }: ViewControlsProps) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onTogglePreview}
        aria-label={showPreview ? "Ẩn preview" : "Hiện preview"}
        title={showPreview ? "Ẩn preview (⌘⇧V)" : "Hiện preview (⌘⇧V)"}
      >
        {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onToggleZen}
        aria-label={zen ? "Tắt Zen" : "Bật Zen (F11)"}
        title={zen ? "Tắt Zen" : "Bật Zen (F11)"}
      >
        {zen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>
    </>
  );
}
