// Brand block on the left of the Topbar: home link, slug, copy-URL, status pill, sync indicator, tag chips.
import { Link } from "react-router-dom";
import * as Y from "yjs";
import { ArrowLeft, Cloud, Copy } from "lucide-react";
import { StatusPill } from "../StatusPill";
import { SyncIndicator } from "../SyncIndicator";
import { TagChips } from "../TagChips";
import type { SaveStatus, SupabaseYjsProvider } from "@/lib/yjs/provider";
import { toast } from "@/hooks/use-toast";

interface TopbarBrandProps {
  slug: string;
  doc: Y.Doc;
  isEncrypted: boolean;
  status: SaveStatus;
  onOpenHistory: () => void;
  /** Phase 2.2 — when present, the SyncIndicator pill renders next to StatusPill. */
  provider?: SupabaseYjsProvider | null;
}

export function TopbarBrand({ slug, doc, isEncrypted, status, onOpenHistory, provider }: TopbarBrandProps) {
  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast({ title: "Đã copy URL", description: window.location.href });
  };

  return (
    <>
      <Link
        to="/"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Trang chủ"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <div className="flex min-w-0 items-center gap-2">
        <Cloud className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-sm font-medium">/{slug}</span>
      </div>

      <button
        onClick={copyUrl}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Copy URL"
        title="Copy URL"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>

      <div className="ml-2 flex items-center gap-1">
        <StatusPill status={status} onClick={onOpenHistory} />
        {provider && <SyncIndicator provider={provider} />}
      </div>

      <TagChips doc={doc} isEncrypted={isEncrypted} />
    </>
  );
}
