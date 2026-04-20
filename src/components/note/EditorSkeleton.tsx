// Lightweight skeleton shown while the editor bundle / IDB / provider are
// still warming up. Mimics the topbar height and editor padding so the layout
// doesn't shift when real content slides in.
export function EditorSkeleton() {
  return (
    <div className="flex h-svh flex-col bg-background">
      <div className="h-11 shrink-0 border-b border-border bg-background/95" />
      <div className="flex-1 min-h-0 overflow-hidden px-6 py-6">
        <div className="mx-auto max-w-[760px] space-y-3">
          <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-9/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-10/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-7/12 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
