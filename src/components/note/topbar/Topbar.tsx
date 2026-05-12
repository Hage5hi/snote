// Topbar container: composes brand, counters, view controls, export & settings menus,
// and owns dialog open-state for rename/duplicate/history/word-goal.
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { ClipboardCopy, Keyboard, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShortcutHelp } from "@/components/ShortcutHelp";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PresenceDots, type PresenceUser } from "../PresenceDots";
import { HistoryDialog } from "../HistoryDialog";
import { LockButton } from "../LockButton";
import { PinButton } from "../PinButton";
import { RenameDialog } from "../RenameDialog";
import { DuplicateDialog } from "../DuplicateDialog";
import { WordGoalDialog } from "../WordGoalDialog";
import { ShareDialog } from "../ShareDialog";
import type { SaveStatus, SupabaseYjsProvider } from "@/lib/yjs/provider";
import { toast } from "@/hooks/use-toast";
import { TopbarBrand } from "./TopbarBrand";
import { WordCountTrigger } from "./WordCountTrigger";
import { ViewControls } from "./ViewControls";
import { ExportMenu } from "./ExportMenu";
import { SettingsMenu } from "./SettingsMenu";

interface TopbarProps {
  slug: string;
  doc: Y.Doc;
  status: SaveStatus;
  provider?: SupabaseYjsProvider | null;
  charCount: number;
  wordCount: number;
  users: PresenceUser[];
  showPreview: boolean;
  onTogglePreview: () => void;
  scrollSync: boolean;
  onToggleScrollSync: () => void;
  zen: boolean;
  onToggleZen: () => void;
  typewriter: boolean;
  onToggleTypewriter: () => void;
  focusLine: boolean;
  onToggleFocusLine: () => void;
  getContent: () => string;
  isEncrypted: boolean;
  paginated: boolean;
  onTogglePagination: () => void;
  /** Compact mode for SplitView panels: hides app-wide toggles (zen, theme,
   *  shortcuts, settings) that would be redundant when two topbars are on
   *  screen. Keeps per-note actions (preview, lock, share, rename, status). */
  compact?: boolean;
}

export function Topbar({
  slug,
  doc,
  status,
  provider,
  charCount,
  wordCount,
  users,
  showPreview,
  onTogglePreview,
  scrollSync,
  onToggleScrollSync,
  zen,
  onToggleZen,
  typewriter,
  onToggleTypewriter,
  focusLine,
  onToggleFocusLine,
  getContent,
  isEncrypted,
  paginated,
  onTogglePagination,
  compact = false,
}: TopbarProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);

  const copyAll = async () => {
    const text = getContent();
    if (!text) {
      toast({ title: "Note đang trống" });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast({ title: "Đã copy toàn bộ note", description: `${text.length} ký tự` });
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
      {zen && !compact && <div className="zen-hover-zone" aria-hidden />}
      <header className="zen-topbar sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <TopbarBrand
          slug={slug}
          doc={doc}
          isEncrypted={isEncrypted}
          status={status}
          onOpenHistory={() => setHistoryOpen(true)}
          provider={provider}
        />

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <WordCountTrigger
            slug={slug}
            words={wordCount}
            chars={charCount}
            onOpen={() => setGoalOpen(true)}
          />

          <PresenceDots users={users} />

          <PinButton slug={slug} />

          <LockButton slug={slug} doc={doc} isEncrypted={isEncrypted} />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={copyAll}
                aria-label="Copy toàn bộ note"
              >
                <ClipboardCopy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Copy toàn bộ nội dung note (⌘⇧C)</TooltipContent>
          </Tooltip>

          <ShareDialog slug={slug} isEncrypted={isEncrypted} />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setRenameOpen(true)}
                aria-label="Đổi tên slug"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Đổi tên slug</TooltipContent>
          </Tooltip>

          <ViewControls
            showPreview={showPreview}
            onTogglePreview={onTogglePreview}
            scrollSync={scrollSync}
            onToggleScrollSync={onToggleScrollSync}
            zen={zen}
            onToggleZen={onToggleZen}
            compact={compact}
          />

          {!compact && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setShortcutsOpen(true)}
                    aria-label="Phím tắt"
                  >
                    <Keyboard className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Xem danh sách phím tắt (?)</TooltipContent>
              </Tooltip>

              <ExportMenu slug={slug} getContent={getContent} isEncrypted={isEncrypted} />

              <SettingsMenu
                slug={slug}
                zen={zen}
                onToggleZen={onToggleZen}
                typewriter={typewriter}
                onToggleTypewriter={onToggleTypewriter}
                focusLine={focusLine}
                onToggleFocusLine={onToggleFocusLine}
                paginated={paginated}
                onTogglePagination={onTogglePagination}
                onOpenRename={() => setRenameOpen(true)}
                onOpenDuplicate={() => setDuplicateOpen(true)}
                onOpenGoal={() => setGoalOpen(true)}
              />

              <ThemeToggle />
            </>
          )}
        </div>
      </header>

      <HistoryDialog slug={slug} doc={doc} open={historyOpen} onOpenChange={setHistoryOpen} />
      <ShortcutHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} currentSlug={slug} />
      <DuplicateDialog open={duplicateOpen} onOpenChange={setDuplicateOpen} currentSlug={slug} />
      <WordGoalDialog
        open={goalOpen}
        onOpenChange={setGoalOpen}
        slug={slug}
        currentWords={wordCount}
      />
    </>
  );
}
