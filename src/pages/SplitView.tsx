import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app/AppShell";
import { useSceneTheme } from "@/hooks/use-scene-theme";
import { saveLastSplitView } from "@/lib/split-view-persistence";
import { useI18n } from "@/i18n";

const NotePage = lazy(() => import("./NotePage"));

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MIN_PANES = 2;
const MAX_PANES = 4;

/**
 * SplitView shows 2–4 notes at once. Route: /:slugs where slugs = "a+b",
 * "a+b+c", or "a+b+c+d". Optional sync-scroll keeps every pane at the same
 * scroll ratio.
 *
 * Layouts:
 *   2 → left | right
 *   3 → top row (n1 | n2), bottom row = n3 full width
 *   4 → 2×2 grid
 */
export default function SplitView() {
  const { slug = "" } = useParams();
  const { t } = useI18n();
  const [syncScroll, setSyncScroll] = useState(true);
  // Refs for each pane container; sync-scroll wires their .cm-scroller children.
  const paneRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Deduplicate: identical slugs on multiple panes cause provider/presence
  // conflicts. Preserve first-occurrence order.
  const slugs = useMemo(
    () => Array.from(new Set(slug.split("+").filter(Boolean))),
    [slug],
  );

  useEffect(() => {
    if (!syncScroll) return;
    const scrollers = paneRefs.current
      .slice(0, slugs.length)
      .map((el) => el?.querySelector(".cm-scroller") as HTMLElement | null)
      .filter((el): el is HTMLElement => !!el);
    if (scrollers.length < 2) return;

    let locked = false;
    const handlers: Array<[HTMLElement, () => void]> = [];
    for (const src of scrollers) {
      const handler = () => {
        if (locked) return;
        const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
        locked = true;
        for (const dst of scrollers) {
          if (dst === src) continue;
          dst.scrollTop = ratio * Math.max(1, dst.scrollHeight - dst.clientHeight);
        }
        requestAnimationFrame(() => (locked = false));
      };
      src.addEventListener("scroll", handler);
      handlers.push([src, handler]);
    }
    return () => {
      for (const [el, h] of handlers) el.removeEventListener("scroll", h);
    };
  }, [syncScroll, slugs]);

  // Invalid: wrong count or any slug fails the regex → go home.
  if (
    rawSlugs.length < MIN_PANES ||
    rawSlugs.length > MAX_PANES ||
    rawSlugs.some((s) => !SLUG_RE.test(s))
  ) {
    return <Navigate to="/" replace />;
  }
  // All identical → collapse to single-note route.
  if (slugs.length === 1) {
    return <Navigate to={`/${slugs[0]}`} replace />;
  }
  // Some duplicates removed → redirect to the canonical unique-slug URL.
  if (slugs.length !== rawSlugs.length) {
    return <Navigate to={`/${slugs.join("+")}`} replace />;
  }

  return (
    <SplitViewBody
      slugs={slugs}
      syncScroll={syncScroll}
      setSyncScroll={setSyncScroll}
      paneRefs={paneRefs}
    />
  );
}

function SplitViewBody({
  slugs,
  syncScroll,
  setSyncScroll,
  paneRefs,
}: {
  slugs: string[];
  syncScroll: boolean;
  setSyncScroll: (v: (b: boolean) => boolean) => void;
  paneRefs: React.MutableRefObject<Array<HTMLDivElement | null>>;
}) {
  const { scene } = useSceneTheme();
  const hasScene = scene !== "none";
  const joined = slugs.join("+");
  const label = slugs.map((s) => `/${s}`).join(" + ");
  const canonical = `https://snote.lovable.app/${joined}`;
  const title = `Split view: ${label} — Syrin Notes`;
  const desc = `Compare ${slugs.length} markdown notes side by side (${label}) with synced scrolling on Syrin Notes.`;

  // Persist current split path so a future "Return to split view" affordance
  // (or a quick remount after Home nav) can restore it. sessionStorage only —
  // this is transient state, not a preference.
  useEffect(() => {
    saveLastSplitView(slugs);
  }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps


  // Layout: 2 → 2 cols; 3 → 2×2 grid, last spans both cols; 4 → 2×2 grid.
  const gridClass =
    slugs.length === 2
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1 md:grid-cols-2 md:grid-rows-2";

  return (
    <AppShell className="flex h-svh flex-col">
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={canonical} />
        {/* eslint-disable-next-line no-restricted-syntax -- SEO control value */}
        <meta name="robots" content="noindex, follow" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={desc} />
      </Helmet>
      <header
        className={
          "flex h-11 shrink-0 items-center gap-3 border-b px-3 text-xs " +
          (hasScene
            ? "motion-safe:backdrop-blur-md"
            : "border-border bg-background/95")
        }
        style={
          hasScene
            ? { background: "var(--home-chrome-bg)", borderColor: "var(--home-chrome-border)" }
            : undefined
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("brand.home")}
              onContextMenu={(e) => {
                e.preventDefault();
                window.open("/", "_blank", "noopener,noreferrer");
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("share.back_home_aria")}</TooltipContent>
        </Tooltip>
        <span className="font-mono truncate">
          {slugs.map((s, i) => (
            <span key={`${s}-${i}`}>
              {i > 0 && <span className="text-muted-foreground"> + </span>}
              /{s}
            </span>
          ))}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={syncScroll ? "default" : "outline"}
              className="ml-auto h-7"
              onClick={() => setSyncScroll((v) => !v)}
            >
              <Link2 className="h-3.5 w-3.5" />
              Sync scroll {syncScroll ? "ON" : "OFF"}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {syncScroll
              ? "Syncing scroll across all panels. Click to disable."
              : "Click to enable synced scrolling between all notes."}
          </TooltipContent>
        </Tooltip>
      </header>
      <main className={`grid flex-1 min-h-0 bg-background divide-border ${gridClass}`}>
        {slugs.map((s, i) => {
          // For 3-pane layout the third pane spans both columns to fill the
          // bottom row.
          const spanClass = slugs.length === 3 && i === 2 ? "md:col-span-2" : "";
          // Borders between panes: right border for left column, bottom border
          // for top row. Simpler than divide-* which doesn't handle the 3-pane
          // asymmetric layout.
          const borderClass = [
            // vertical divider between columns (all layouts, not on last column)
            i % 2 === 0 && !(slugs.length === 3 && i === 2) ? "md:border-r md:border-border" : "",
            // horizontal divider between rows (3/4-pane, top row only)
            slugs.length >= 3 && i < 2 ? "border-b border-border md:border-b" : "",
            // mobile stacking: separator between stacked panes
            i > 0 ? "border-t border-border md:border-t-0" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={`${s}-${i}`}
              ref={(el) => {
                paneRefs.current[i] = el;
              }}
              data-split-view-pane={i}
              data-split-view-slug={s}
              className={`min-h-0 min-w-0 overflow-hidden ${spanClass} ${borderClass}`}
            >
              <Suspense fallback={<div className="h-full bg-background" />}>
                <NotePage embedSlug={s} />
              </Suspense>
            </div>
          );
        })}
      </main>
    </AppShell>
  );
}
