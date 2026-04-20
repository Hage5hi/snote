import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as Y from "yjs";
import {
  ArrowLeft,
  BookOpen,
  ClipboardCopy,
  Cloud,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode,
  FileType,
  Link2,
  Maximize2,
  Minimize2,
  MonitorSmartphone,
  Settings2,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PresenceDots, type PresenceUser } from "./PresenceDots";
import { HistoryDialog } from "./HistoryDialog";
import { LockButton } from "./LockButton";
import { ShareDialog } from "./ShareDialog";
import { StatusPill } from "./StatusPill";
import type { SaveStatus } from "@/lib/yjs/provider";
import { exportMarkdown, exportPlainText, exportHtml, exportPdf } from "@/lib/export";
import { formatForAI, approxTokens } from "@/lib/ai-format";
import { toast } from "@/hooks/use-toast";
import { useEink } from "@/hooks/use-eink";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface TopbarProps {
  slug: string;
  doc: Y.Doc;
  status: SaveStatus;
  charCount: number;
  wordCount: number;
  users: PresenceUser[];
  showPreview: boolean;
  onTogglePreview: () => void;
  zen: boolean;
  onToggleZen: () => void;
  getContent: () => string;
  isEncrypted: boolean;
  paginated: boolean;
  onTogglePagination: () => void;
}

export function Topbar({
  slug,
  doc,
  status,
  charCount,
  wordCount,
  users,
  showPreview,
  onTogglePreview,
  zen,
  onToggleZen,
  getContent,
  isEncrypted,
  paginated,
  onTogglePagination,
}: TopbarProps) {
  const { pref: einkPref, setMode: setEinkMode } = useEink();

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast({ title: "Đã copy URL", description: window.location.href });
  };

  const copyAll = async () => {
    const text = getContent();
    if (!text) {
      toast({ title: "Note đang trống" });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast({ title: "Đã copy toàn bộ note", description: `${text.length} ký tự` });
  };

  const copyAsAI = async () => {
    const text = getContent();
    if (!text) {
      toast({ title: "Note đang trống" });
      return;
    }
    const formatted = formatForAI(slug, text);
    await navigator.clipboard.writeText(formatted);
    toast({
      title: "Đã copy cho AI",
      description: `~${approxTokens(formatted)} tokens`,
    });
  };

  const copyRawUrl = async () => {
    const url = `${SUPABASE_URL}/functions/v1/raw/${slug}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: "Đã copy raw URL",
      description: "Dùng cho cURL / wget / Python",
    });
  };

  // Cmd/Ctrl + Shift + C to copy all. Cmd/Ctrl + Shift + V to toggle preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "c" || e.key === "C")) {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        e.preventDefault();
        copyAll();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        onTogglePreview();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getContent, onTogglePreview]);

  return (
    <>
      {zen && <div className="zen-hover-zone" aria-hidden />}
      <header className="zen-topbar sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
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

        <div className="ml-2"><StatusPill status={status} /></div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
            <span>{wordCount} words</span>
            <span>{charCount} chars</span>
          </div>

          <PresenceDots users={users} />

          <LockButton slug={slug} doc={doc} isEncrypted={isEncrypted} />

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={copyAll}
            aria-label="Copy toàn bộ note"
            title="Copy toàn bộ (Cmd/Ctrl+Shift+C)"
          >
            <ClipboardCopy className="h-4 w-4" />
          </Button>

          <HistoryDialog slug={slug} doc={doc} />

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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Export">
                <Download className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportMarkdown(slug, getContent())}>
                <Download className="h-3.5 w-3.5" /> Download .md
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportHtml(slug, getContent())}>
                <FileCode className="h-3.5 w-3.5" /> Download .html
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportPdf(slug, getContent())}>
                <FileType className="h-3.5 w-3.5" /> Print to PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportPlainText(slug, getContent())}>
                <Download className="h-3.5 w-3.5" /> Download .txt
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={copyAsAI}>
                <Sparkles className="h-3.5 w-3.5" /> Copy as AI context
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={copyRawUrl}
                disabled={isEncrypted}
                title="URL trỏ thẳng edge function — cURL/wget nhận text/plain ngay (không qua SPA)"
              >
                <Terminal className="h-3.5 w-3.5" /> Copy raw URL (cURL)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Cài đặt">
                <Settings2 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="flex items-center gap-2 text-xs">
                <MonitorSmartphone className="h-3.5 w-3.5" />
                E-ink mode
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={einkPref}
                onValueChange={(v) => setEinkMode(v as "auto" | "on" | "off")}
              >
                <DropdownMenuRadioItem value="auto">Auto-detect</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="on">Bật</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="off">Tắt</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onToggleZen}>
                {zen ? "Tắt Zen mode" : "Bật Zen mode"}
                <span className="ml-auto text-[10px] text-muted-foreground">F11</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onTogglePagination}>
                <BookOpen className="h-3.5 w-3.5" />
                {paginated ? "Tắt Lật trang" : "Bật Lật trang"}
                <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧P</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2 text-xs">
                <Link2 className="h-3.5 w-3.5" />
                Split view
              </DropdownMenuLabel>
              <DropdownMenuItem
                className="text-xs text-muted-foreground"
                onSelect={(e) => e.preventDefault()}
              >
                Mở URL <code className="mx-1 font-mono">/a+b</code> để xem 2 note cạnh nhau.
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ThemeToggle />
        </div>
      </header>
    </>
  );
}
