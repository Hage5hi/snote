// Topbar: brand + counters + per-note icons + Note/Mode/Export/Help dropdowns + theme.
// Inspired by Replit's topbar — text-label menus replace the dense icon row.
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import type { SupabaseYjsProvider } from "@/lib/yjs/provider";
import { toast } from "@/hooks/use-toast";
import { TopbarBrand } from "./TopbarBrand";
import { WordCountTrigger } from "./WordCountTrigger";
import { ViewControls } from "./ViewControls";
import { ExportMenu } from "./ExportMenu";
import { NoteMenu } from "./NoteMenu";
import { ModeMenu } from "./ModeMenu";
import { HelpMenu } from "./HelpMenu";
import { CopyUrlButton } from "./CopyUrlButton";

interface TopbarProps {
  slug: string;
  doc: Y.Doc;
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
  /** Compact mode for SplitView panels: hides app-wide menus (Mode, Help, theme)
   *  that would be redundant when two topbars are on screen. Keeps per-note
   *  icons + Note + Export. */
  compact?: boolean;
}

export function Topbar({
  slug,
  doc,
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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
  // ? to open shortcuts (when not typing in a field).
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
          provider={provider}
        />

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <WordCountTrigger
            slug={slug}
            words={wordCount}
            chars={charCount}
            onOpen={() => setGoalOpen(true)}
          />

          <PresenceDots users={users} />

          <PinButton slug={slug} />

          <LockButton slug={slug} doc={doc} isEncrypted={isEncrypted} />

          <ShareDialog slug={slug} isEncrypted={isEncrypted} />

          <ViewControls
            showPreview={showPreview}
            onTogglePreview={onTogglePreview}
            scrollSync={scrollSync}
            onToggleScrollSync={onToggleScrollSync}
          />

          <CopyUrlButton />

          <Separator orientation="vertical" className="mx-1 h-5" />

          <NoteMenu
            onOpenRename={() => setRenameOpen(true)}
            onOpenDuplicate={() => setDuplicateOpen(true)}
            onOpenGoal={() => setGoalOpen(true)}
            onOpenHistory={() => setHistoryOpen(true)}
            onCopyAll={copyAll}
          />

          {!compact && (
            <ModeMenu
              zen={zen}
              onToggleZen={onToggleZen}
              typewriter={typewriter}
              onToggleTypewriter={onToggleTypewriter}
              focusLine={focusLine}
              onToggleFocusLine={onToggleFocusLine}
              paginated={paginated}
              onTogglePagination={onTogglePagination}
            />
          )}

          <ExportMenu slug={slug} getContent={getContent} isEncrypted={isEncrypted} />

          {!compact && (
            <>
              <HelpMenu onOpenShortcuts={() => setShortcutsOpen(true)} />

              <Separator orientation="vertical" className="mx-1 h-5" />

              <ThemeToggle />
            </>
          )}
        </div>
      </header>

      <HistoryDialog
        slug={slug}
        doc={doc}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        trigger={false}
      />
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
