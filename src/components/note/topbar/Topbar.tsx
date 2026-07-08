// Topbar: brand + counters + per-note icons + Note/Mode/Export/Help dropdowns + theme.
// Inspired by Replit's topbar — text-label menus replace the dense icon row.
//
// Responsive layout:
//   - Wide (≥ 900 px): single 44 px row with everything inline.
//   - Narrow (< 900 px): wraps to two rows so the 14+ controls fit without
//     horizontal overflow. Row 1 (44 px) keeps brand + theme + the preview
//     toggle pinned to the right so it is ALWAYS visible. Row 2 (36 px)
//     holds the per-note icons and the four dropdown menus.
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ShortcutHelp } from "@/components/ShortcutHelp";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SceneToggle } from "@/components/SceneToggle";
import { useSceneTheme } from "@/hooks/use-scene-theme";
import { PresenceDots, type PresenceUser } from "../PresenceDots";
import { HistoryDialog } from "../HistoryDialog";
import { LockButton } from "../LockButton";
import { PinButton } from "../PinButton";
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
import { useNarrowViewport } from "@/hooks/use-narrow-viewport";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/i18n";


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
  const [goalOpen, setGoalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const narrow = useNarrowViewport();
  const isMobile = useIsMobile();
  const showSceneToggle = !compact && !isMobile;
  const { t } = useI18n();
  const { scene } = useSceneTheme();
  const hasScene = scene !== "none";
  const sceneHeaderStyle = hasScene
    ? { background: "var(--home-chrome-bg)", borderColor: "var(--home-chrome-border)" }
    : undefined;
  const sceneHeaderClass = hasScene
    ? "border-b motion-safe:backdrop-blur-md"
    : "border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80";

  const copyAll = async () => {
    const text = getContent();
    if (!text) {
      toast({ title: t("toast.note_empty") });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast({ title: t("toast.copied_note"), description: t("toast.copied_chars", { n: text.length }) });
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
      {narrow ? (
        <header
          className={`zen-topbar sticky top-0 z-30 flex flex-col ${sceneHeaderClass}`}
          style={sceneHeaderStyle}
        >
          {/* Row 1: brand + theme + preview toggle (always visible, never
              pushed off-screen by the menus on row 2). */}
          <div className="flex h-11 items-center gap-2 px-2">
            <TopbarBrand
              slug={slug}
              doc={doc}
              isEncrypted={isEncrypted}
              provider={provider}
              getContent={getContent}
              hideHome={compact}
            />

            <div className="ml-auto flex shrink-0 items-center gap-1">
              {showSceneToggle && (
                <span className="hidden md:inline-flex">
                  <SceneToggle />
                </span>
              )}
              {!compact && <ThemeToggle />}
              <ViewControls
                showPreview={showPreview}
                onTogglePreview={onTogglePreview}
                scrollSync={scrollSync}
                onToggleScrollSync={onToggleScrollSync}
              />
            </div>
          </div>
          {/* Row 2: per-note actions + dropdown menus. Narrower height so the
              total stack stays close to one row of vertical space. */}
          <div className="flex h-9 items-center gap-1 border-t border-border/40 px-2">
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
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <NoteMenu
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
              {!compact && <HelpMenu onOpenShortcuts={() => setShortcutsOpen(true)} />}
            </div>
          </div>
        </header>
      ) : (
        <header
          className={`zen-topbar sticky top-0 z-30 flex h-11 items-center gap-2 px-3 ${sceneHeaderClass}`}
          style={sceneHeaderStyle}
        >
          <TopbarBrand
            slug={slug}
            doc={doc}
            isEncrypted={isEncrypted}
            provider={provider}
            getContent={getContent}
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

            <Separator orientation="vertical" className="mx-1 h-5" />

            <NoteMenu
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

                {!isMobile && (
                  <span className="hidden md:inline-flex">
                    <SceneToggle />
                  </span>
                )}
                <ThemeToggle />
              </>
            )}
          </div>
        </header>
      )}

      <HistoryDialog
        slug={slug}
        doc={doc}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        trigger={false}
      />
      <ShortcutHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <WordGoalDialog
        open={goalOpen}
        onOpenChange={setGoalOpen}
        slug={slug}
        currentWords={wordCount}
      />
    </>
  );
}
