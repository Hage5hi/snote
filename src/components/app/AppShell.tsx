// AppShell — shared scene-aware wrapper for top-level routes.
//
// Sets the `data-app-root` + `data-scene` attributes that drive the per-scene
// CSS variables in index.css ([data-app-root][data-scene="<id>"] { --home-* }),
// and mounts <SceneHost /> behind the content when a scene is active.
//
// The `data-app-root` name is a historical leftover from when scenes lived
// only on Home — kept as-is to avoid a churny rename across index.css. It now
// effectively means "scene-aware app surface".
//
// Body background flips to transparent when a scene is active so the
// SceneHost layer shows through. Chrome elements (topbar, etc.) read the
// per-scene `--home-chrome-*` tokens directly.
import { useSceneTheme } from "@/hooks/use-scene-theme";
import SceneHost from "@/components/home/SceneHost";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
  /** Extra classes for the outer container. */
  className?: string;
  /** When true (default), background goes transparent under a scene so the
   *  SceneHost layer shows through. Pass false for surfaces whose body MUST
   *  stay opaque even with a scene (none currently). */
  transparentBody?: boolean;
}

export function AppShell({ children, className, transparentBody = true }: AppShellProps) {
  const { scene } = useSceneTheme();
  const hasScene = scene !== "none";
  return (
    <div
      data-app-root="true"
      data-scene={hasScene ? scene : undefined}
      className={cn(
        "relative isolate",
        hasScene && transparentBody ? "bg-transparent" : "bg-background",
        className,
      )}
    >
      {hasScene && <SceneHost />}
      {children}
    </div>
  );
}
