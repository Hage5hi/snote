import { Link } from "react-router-dom";
import { ArrowLeft, Check, Cloud, CloudOff, Copy, Download, Eye, EyeOff, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PresenceDots, type PresenceUser } from "./PresenceDots";
import type { SaveStatus } from "@/lib/yjs/provider";
import { exportMarkdown, exportPlainText } from "@/lib/export";
import { toast } from "@/hooks/use-toast";

interface TopbarProps {
  slug: string;
  status: SaveStatus;
  charCount: number;
  wordCount: number;
  users: PresenceUser[];
  showPreview: boolean;
  onTogglePreview: () => void;
  getContent: () => string;
}

function StatusPill({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { icon: JSX.Element; label: string; cls: string }> = {
    idle: { icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "Connecting…", cls: "text-muted-foreground" },
    editing: { icon: <Pencil className="h-3 w-3" />, label: "Editing…", cls: "text-muted-foreground" },
    saving: { icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "Saving…", cls: "text-muted-foreground" },
    saved: { icon: <Check className="h-3 w-3" />, label: "Saved", cls: "text-success" },
    offline: { icon: <CloudOff className="h-3 w-3" />, label: "Offline", cls: "text-warning" },
  };
  const v = map[status];
  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-medium ${v.cls}`}>
      {v.icon}
      <span>{v.label}</span>
    </div>
  );
}

export function Topbar({
  slug,
  status,
  charCount,
  wordCount,
  users,
  showPreview,
  onTogglePreview,
  getContent,
}: TopbarProps) {
  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast({ title: "Đã copy URL", description: window.location.href });
  };

  return (
    <header className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
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
      >
        <Copy className="h-3.5 w-3.5" />
      </button>

      <div className="ml-2"><StatusPill status={status} /></div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
          <span>{wordCount} words</span>
          <span>{charCount} chars</span>
        </div>

        <PresenceDots users={users} />

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onTogglePreview}
          aria-label={showPreview ? "Ẩn preview" : "Hiện preview"}
        >
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Export">
              <Download className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportMarkdown(slug, getContent())}>
              Download .md
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportPlainText(slug, getContent())}>
              Download .txt
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ThemeToggle />
      </div>
    </header>
  );
}
