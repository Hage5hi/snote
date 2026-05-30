// Brand block on the left of the Topbar: home link, slug (click → copy URL),
// copy-content button, sync indicator, tag chips.
//
// UX split:
//   - Click the `/slug` text → copies the canonical URL (origin + /slug). The
//     origin is read at click time so custom domains (note.syrin.online) and
//     preview deploys (*.lovable.app) always produce the right link without
//     any hard-coded host.
//   - Click the Copy icon → copies the FULL note body. This used to be a
//     duplicate "Copy URL" action; users have keyboard shortcut + the slug
//     button for that now, so the icon graduates to the more useful action.
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
  /** Returns the current decrypted note body. Used by the Copy icon button. */
  getContent: () => string;
}

export function TopbarBrand({ slug, doc, isEncrypted, provider, getContent }: TopbarBrandProps) {
  const { t } = useI18n();

  const copyUrl = async () => {
    // Canonical share host is the apex syrin.online. The app is also reachable
    // via note.syrin.online and *.lovable.app, but copied URLs should always
    // point at the short canonical form.
    const { origin, hostname } = window.location;
    const canonicalOrigin =
      hostname === "syrin.online" ||
      hostname === "note.syrin.online" ||
      hostname.endsWith(".syrin.online")
        ? "https://syrin.online"
        : origin;
    const url = `${canonicalOrigin}/${slug}`;
    await navigator.clipboard.writeText(url);
    toast({ title: t("toast.copied_url"), description: url });
  };

  const copyContent = async () => {
    const text = getContent();
    if (!text) {
      toast({ title: t("toast.note_empty") });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast({
      title: t("toast.copied_note"),
      description: t("toast.copied_chars", { n: text.length }),
    });
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={copyUrl}
              className="truncate rounded-md px-1 font-mono text-sm font-medium hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={t("brand.copy_url")}
            >
              /{slug}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("brand.copy_url")}</TooltipContent>
        </Tooltip>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={copyContent}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("brand.copy_content")}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("brand.copy_content")}</TooltipContent>
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
