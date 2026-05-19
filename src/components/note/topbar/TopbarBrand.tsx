// Brand block on the left of the Topbar: home link, slug, copy-URL, sync indicator, tag chips.
import { Link } from "react-router-dom";
import * as Y from "yjs";
import { ArrowLeft, Cloud, Copy, List } from "lucide-react";
import { SyncIndicator } from "../SyncIndicator";
import { TagChips } from "../TagChips";
import { OUTLINE_TOGGLE_EVENT } from "../OutlineSidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SupabaseYjsProvider } from "@/lib/yjs/provider";
import { toast } from "@/hooks/use-toast";

interface TopbarBrandProps {
  slug: string;
  doc: Y.Doc;
  isEncrypted: boolean;
  /** Phase 2.2 — when present, the SyncIndicator pill renders here. */
  provider?: SupabaseYjsProvider | null;
}

export function TopbarBrand({ slug, doc, isEncrypted, provider }: TopbarBrandProps) {
  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast({ title: "Đã copy URL", description: window.location.href });
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Trang chủ"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">Trang chủ</TooltipContent>
      </Tooltip>

      <div className="flex min-w-0 items-center gap-2">
        <Cloud className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-sm font-medium">/{slug}</span>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={copyUrl}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Copy URL"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Copy URL</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => window.dispatchEvent(new Event(OUTLINE_TOGGLE_EVENT))}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Outline"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Outline (⌘\)</TooltipContent>
      </Tooltip>

      {provider && (
        <div className="ml-2 flex items-center gap-1">
          <SyncIndicator provider={provider} />
        </div>
      )}

      <TagChips doc={doc} isEncrypted={isEncrypted} />
    </>
  );
}
