import { useMemo } from "react";
import { diffLines } from "diff";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SnapshotDiffProps {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
}

export function SnapshotDiff({ oldText, newText, oldLabel, newLabel }: SnapshotDiffProps) {
  const parts = useMemo(() => diffLines(oldText, newText), [oldText, newText]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const p of parts) {
      const lines = p.count ?? p.value.split("\n").length;
      if (p.added) added += lines;
      else if (p.removed) removed += lines;
    }
    return { added, removed };
  }, [parts]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          <span className="text-destructive">− {oldLabel}</span>
          {" → "}
          <span className="text-success">+ {newLabel}</span>
        </span>
        <span className="tabular-nums">
          <span className="text-success">+{stats.added}</span>{" "}
          <span className="text-destructive">−{stats.removed}</span>
        </span>
      </div>
      <ScrollArea className="h-[55vh] rounded-md border border-border bg-muted/20">
        <pre className="font-mono text-xs leading-relaxed">
          {parts.map((p, i) => {
            if (p.added) {
              return (
                <div key={i} className="bg-success/15 text-success-foreground">
                  {p.value.split("\n").map((line, j, arr) =>
                    j === arr.length - 1 && line === "" ? null : (
                      <div key={j} className="px-2">
                        <span className="select-none text-success/70">+ </span>
                        {line || "\u00A0"}
                      </div>
                    ),
                  )}
                </div>
              );
            }
            if (p.removed) {
              return (
                <div key={i} className="bg-destructive/15 text-destructive-foreground">
                  {p.value.split("\n").map((line, j, arr) =>
                    j === arr.length - 1 && line === "" ? null : (
                      <div key={j} className="px-2">
                        <span className="select-none text-destructive/70">− </span>
                        {line || "\u00A0"}
                      </div>
                    ),
                  )}
                </div>
              );
            }
            return (
              <div key={i} className="text-muted-foreground/80">
                {p.value.split("\n").map((line, j, arr) =>
                  j === arr.length - 1 && line === "" ? null : (
                    <div key={j} className="px-2">
                      <span className="select-none opacity-40">  </span>
                      {line || "\u00A0"}
                    </div>
                  ),
                )}
              </div>
            );
          })}
        </pre>
      </ScrollArea>
    </div>
  );
}
