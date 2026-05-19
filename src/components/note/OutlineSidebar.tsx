import { useEffect, useState } from "react";
import * as Y from "yjs";
import { X } from "lucide-react";

export const OUTLINE_TOGGLE_EVENT = "outline:toggle";
import { parseOutline, type Heading } from "@/lib/outline";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/index";


interface OutlineSidebarProps {
  doc: Y.Doc;
  /** Called with a 0-indexed line number when user clicks a heading. */
  onJump: (line: number) => void;
}

/**
 * Slide-in Table of Contents from the LEFT.
 *  - Toggle with the floating button or Cmd/Ctrl+\
 *  - Lives outside the editor so it never reflows the writing area.
 *  - Re-parses on every Y.Text change (debounced via observe coalescing).
 */
export function OutlineSidebar({ doc, onJump }: OutlineSidebarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [headings, setHeadings] = useState<Heading[]>([]);

  // Re-parse outline whenever the doc changes, but defer to idle callbacks so
  // long notes don't pay parse cost on every keystroke.
  useEffect(() => {
    const ytext = doc.getText("content");
    let timer: number | null = null;
    let ridle: number | null = null;
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const run = () => setHeadings(parseOutline(ytext.toString()));
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      if (ridle) w.cancelIdleCallback?.(ridle);
      timer = window.setTimeout(() => {
        if (w.requestIdleCallback) ridle = w.requestIdleCallback(run, { timeout: 600 });
        else run();
      }, 200);
    };
    run();
    ytext.observe(schedule);
    return () => {
      if (timer) window.clearTimeout(timer);
      if (ridle) w.cancelIdleCallback?.(ridle);
      ytext.unobserve(schedule);
    };
  }, [doc]);

  // Cmd/Ctrl+\ toggle + external trigger via OUTLINE_TOGGLE_EVENT.
  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OUTLINE_TOGGLE_EVENT, toggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OUTLINE_TOGGLE_EVENT, toggle);
    };
  }, []);

  const handleJump = (line: number) => {
    onJump(line);
    // Keep open on desktop, close on small screens to free up space.
    if (window.innerWidth < 768) setOpen(false);
  };

  return (
    <>
      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-background/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={`zen-hide fixed left-0 top-11 bottom-0 z-40 w-72 max-w-[85vw] border-r border-border bg-background shadow-lg transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Outline"
      >
        <div className="flex h-10 items-center justify-between border-b border-border px-3">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Outline
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setOpen(false)}
            aria-label={t("outline.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="h-[calc(100%-2.5rem)] overflow-y-auto px-2 py-2">
          {headings.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              {t("outline.empty_prefix")} <code className="font-mono">#</code>,{" "}
              <code className="font-mono">##</code>, <code className="font-mono">###</code>{" "}
              {t("outline.empty_suffix")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {headings.map((h, idx) => (
                <li key={`${h.line}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => handleJump(h.line)}
                    className="block w-full truncate rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    style={{ paddingLeft: `${0.5 + (h.level - 1) * 0.75}rem` }}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
