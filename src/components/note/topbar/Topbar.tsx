// Topbar container: composes brand, counters, view controls, export & settings menus,
// and owns dialog open-state for rename/duplicate/history/word-goal.
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { ClipboardCopy, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { SaveStatus } from "@/lib/yjs/provider";
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
      {zen && <div className="zen-hover-zone" aria-hidden />}
      <header className="zen-topbar sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <TopbarBrand
          slug={slug}
          doc={doc}
          isEncrypted={isEncrypted}
          status={status}
          onOpenHistory={() => setHistoryOpen(true)}
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

          <ShareDialog isEncrypted={isEncrypted} />

          <ViewControls
            showPreview={showPreview}
            onTogglePreview={onTogglePreview}
            zen={zen}
            onToggleZen={onToggleZen}
          />

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShortcutsOpen(true)}
            aria-label="Phím tắt"
            title="Phím tắt (?)"
          >
            <Keyboard className="h-4 w-4" />
          </Button>

          <ExportMenu slug={slug} getContent={getContent} isEncrypted={isEncrypted} />

          <SettingsMenu
            slug={slug}
            zen={zen}
            onToggleZen={onToggleZen}
            paginated={paginated}
            onTogglePagination={onTogglePagination}
            onOpenRename={() => setRenameOpen(true)}
            onOpenDuplicate={() => setDuplicateOpen(true)}
            onOpenGoal={() => setGoalOpen(true)}
          />

          <ThemeToggle />
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
