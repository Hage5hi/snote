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
import { useI18n } from "@/i18n";

interface TopbarBrandProps {
  slug: string;
  doc: Y.Doc;
  isEncrypted: boolean;
  /** Phase 2.2 — when present, the SyncIndicator pill renders here. */
  provider?: SupabaseYjsProvider | null;
}

export function TopbarBrand({ slug, doc, isEncrypted, provider }: TopbarBrandProps) {
  const { t } = useI18n();
  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast({ title: t("toast.copied_url"), description: window.location.href });
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("brand.home")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("brand.home")}</TooltipContent>
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
            aria-label={t("brand.copy_url")}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("brand.copy_url")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => window.dispatchEvent(new Event(OUTLINE_TOGGLE_EVENT))}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("brand.outline")}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("brand.outline")} (⌘\)</TooltipContent>
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
