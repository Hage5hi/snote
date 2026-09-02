import { lazy, Suspense, useEffect, useState } from "react";
import { CMDK_OPEN_EVENT } from "@/lib/cmdk-open";

const CommandPaletteBody = lazy(() => import("./CommandPaletteBody"));
const ShortcutHelp = lazy(() =>
  import("./ShortcutHelp").then((m) => ({ default: m.ShortcutHelp })),
);

function isPaletteToggle(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
  const key = e.key.toLowerCase();
  return key === "k" || key === "p";
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [everHelp, setEverHelp] = useState(false);
  const [seedQuery, setSeedQuery] = useState("");
  const [seedNonce, setSeedNonce] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteToggle(e)) {
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
    const onSeed = (e: Event) => {
      const query = String((e as CustomEvent<{ query?: string }>).detail?.query ?? "");
      setEverOpened(true);
      setOpen(true);
      setSeedQuery(query);
      setSeedNonce((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(CMDK_OPEN_EVENT, onSeed);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(CMDK_OPEN_EVENT, onSeed);
    };
  }, []);

  const openHelp = () => {
    setEverHelp(true);
    setHelpOpen(true);
  };

  return (
    <>
      {everOpened && (
        <Suspense fallback={null}>
          <CommandPaletteBody
            open={open}
            onOpenChange={setOpen}
            onOpenHelp={openHelp}
            seedQuery={seedQuery}
            seedNonce={seedNonce}
          />
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
