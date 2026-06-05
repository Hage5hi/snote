import { lazy, Suspense, useEffect, useState } from "react";

const CommandPaletteBody = lazy(() => import("./CommandPaletteBody"));
const ShortcutHelp = lazy(() =>
  import("./ShortcutHelp").then((m) => ({ default: m.ShortcutHelp })),
);

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [everHelp, setEverHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setEverOpened(true);
        setOpen((v) => !v);
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (target) {
          const tag = target.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
        }
        e.preventDefault();
        setEverHelp(true);
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openHelp = () => {
    setEverHelp(true);
    setHelpOpen(true);
  };

  return (
    <>
      {everOpened && (
        <Suspense fallback={null}>
          <CommandPaletteBody open={open} onOpenChange={setOpen} onOpenHelp={openHelp} />
        </Suspense>
      )}
      {everHelp && (
        <Suspense fallback={null}>
          <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
        </Suspense>
      )}
    </>
  );
}
