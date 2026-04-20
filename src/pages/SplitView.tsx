import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NotePage = lazy(() => import("./NotePage"));

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * SplitView shows two notes side-by-side. Route: /:slugs where slugs = "a+b".
 * Optional sync-scroll keeps the two panels at the same scroll ratio.
 */
export default function SplitView() {
  const { slug = "" } = useParams();
  const [left, right] = slug.split("+");
  const [syncScroll, setSyncScroll] = useState(true);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!syncScroll) return;
    const lEl = leftRef.current?.querySelector(".cm-scroller") as HTMLElement | null;
    const rEl = rightRef.current?.querySelector(".cm-scroller") as HTMLElement | null;
    if (!lEl || !rEl) return;

    let locked = false;
    const sync = (from: HTMLElement, to: HTMLElement) => () => {
      if (locked) return;
      const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
      locked = true;
      to.scrollTop = ratio * Math.max(1, to.scrollHeight - to.clientHeight);
      requestAnimationFrame(() => (locked = false));
    };
    const onL = sync(lEl, rEl);
    const onR = sync(rEl, lEl);
    lEl.addEventListener("scroll", onL);
    rEl.addEventListener("scroll", onR);
    return () => {
      lEl.removeEventListener("scroll", onL);
      rEl.removeEventListener("scroll", onR);
    };
  }, [syncScroll, left, right]);

  if (!SLUG_RE.test(left ?? "") || !SLUG_RE.test(right ?? "")) {
    return <Navigate to="/" replace />;
  }
  // Same slug on both sides causes provider/presence conflicts — collapse to single note.
  if (left === right) {
    return <Navigate to={`/${left}`} replace />;
  }

  return (
    <div className="flex h-svh flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 text-xs">
        <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label="Trang chủ">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="font-mono">
          /{left} <span className="text-muted-foreground">+</span> /{right}
        </span>
        <Button
          size="sm"
          variant={syncScroll ? "default" : "outline"}
          className="ml-auto h-7"
          onClick={() => setSyncScroll((v) => !v)}
        >
          <Link2 className="h-3.5 w-3.5" />
          Sync scroll {syncScroll ? "ON" : "OFF"}
        </Button>
      </header>
      <main className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-2 divide-y md:divide-x md:divide-y-0 divide-border">
        <div ref={leftRef} className="min-h-0 overflow-hidden">
          <Suspense fallback={<div className="h-full bg-background" />}>
            <NotePage embedSlug={left} />
          </Suspense>
        </div>
        <div ref={rightRef} className="min-h-0 overflow-hidden">
          <Suspense fallback={<div className="h-full bg-background" />}>
            <NotePage embedSlug={right} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
