import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/index";
import { diffHunks, type DiffHunk } from "@/lib/snapshot-history";

interface SnapshotDiffProps {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
  selectable?: boolean;
  selectedIds?: readonly string[];
  onToggleHunk?: (id: string, selected: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
}

export function SnapshotDiff({
  oldText,
  newText,
  oldLabel,
  newLabel,
  selectable = false,
  selectedIds = [],
  onToggleHunk,
  onToggleAll,
}: SnapshotDiffProps) {
  const { t } = useI18n();
  const hunks = useMemo(() => diffHunks(oldText, newText), [oldText, newText]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") added += 1;
        else if (line.type === "remove") removed += 1;
      }
    }
    return { added, removed };
  }, [hunks]);

  const allSelected = hunks.length > 0 && hunks.every((h) => selected.has(h.id));

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
      {selectable && hunks.length > 0 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-history-hunk-select-all
            onClick={() => onToggleAll?.(!allSelected)}
          >
            {allSelected ? t("history.hunk.clear") : t("history.hunk.select_all")}
          </Button>
        </div>
      )}
      <ScrollArea className="h-[55vh] rounded-md border border-border bg-muted/20">
        {hunks.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t("history.hunk.empty")}</p>
        ) : (
          <pre className="font-mono text-xs leading-relaxed">
            {hunks.map((hunk) => (
              <HunkBlock
                key={hunk.id}
                hunk={hunk}
                selectable={selectable}
                checked={selected.has(hunk.id)}
                ariaLabel={t("history.hunk.aria")}
                onToggle={onToggleHunk}
              />
            ))}
          </pre>
        )}
      </ScrollArea>
    </div>
  );
}

function HunkBlock({
  hunk,
  selectable,
  checked,
  ariaLabel,
  onToggle,
}: {
  hunk: DiffHunk;
  selectable: boolean;
  checked: boolean;
  ariaLabel: string;
  onToggle?: (id: string, selected: boolean) => void;
}) {
  return (
    <div
      className="border-b border-border/60 last:border-b-0"
      data-history-hunk-block={hunk.id}
    >
      {selectable && (
        <div className="flex items-center gap-2 bg-muted/40 px-2 py-1">
          <Checkbox
            checked={checked}
            onCheckedChange={(value) => onToggle?.(hunk.id, value === true)}
            aria-label={ariaLabel}
            data-history-hunk={hunk.id}
          />
        </div>
      )}
      {hunk.lines.map((line, j) => {
        if (line.type === "add") {
          return (
            <div key={j} className="bg-success/15 px-2 text-success-foreground">
              <span className="select-none text-success/70">+ </span>
              {line.text || "\u00A0"}
            </div>
          );
        }
        if (line.type === "remove") {
          return (
            <div key={j} className="bg-destructive/15 px-2 text-destructive-foreground">
              <span className="select-none text-destructive/70">− </span>
              {line.text || "\u00A0"}
            </div>
          );
        }
        return (
          <div key={j} className="px-2 text-muted-foreground/80">
            <span className="select-none opacity-40">  </span>
            {line.text || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}
