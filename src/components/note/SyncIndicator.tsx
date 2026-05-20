// Phase 2.2 — Visual indicator for SupabaseYjsProvider sync state.
//
// Hover → Tooltip (compact label).  Click → Popover (details: pending bytes,
// last broadcast/snapshot, last error, dismiss buttons).
//
// 5 statuses: synced / syncing / conflict / error / offline.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CloudOff,
  GitMerge,
  Loader2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useI18n, type TKey } from "@/i18n";
import {
  useSyncStatus,
  type SyncIndicatorStatus,
} from "@/hooks/use-sync-status";
import type { SupabaseYjsProvider } from "@/lib/yjs/provider";

interface SyncIndicatorProps {
  provider: SupabaseYjsProvider | null;
}

interface PillStyle {
  Icon: typeof Check;
  cls: string;
  spin?: boolean;
}

const STYLES: Record<SyncIndicatorStatus, PillStyle> = {
  synced:   { Icon: Check,          cls: "text-success" },
  syncing:  { Icon: Loader2,        cls: "text-muted-foreground", spin: true },
  conflict: { Icon: GitMerge,       cls: "text-warning" },
  error:    { Icon: AlertTriangle,  cls: "text-destructive" },
  offline:  { Icon: CloudOff,       cls: "text-warning" },
};

function relTime(t: (k: TKey, v?: Record<string, string | number>) => string, ms: number): string {
  if (ms < 5_000) return t("sync.time.just_now");
  const s = Math.floor(ms / 1000);
  if (s < 60) return t("sync.time.s_ago", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("sync.time.m_ago", { n: m });
  const h = Math.floor(m / 60);
  return t("sync.time.h_ago", { n: h });
}

export function SyncIndicator({ provider }: SyncIndicatorProps) {
  const snap = useSyncStatus(provider);
  const { t } = useI18n();
  const now = Date.now();

  const { Icon, cls, spin } = STYLES[snap.status];

  // U4 — pulse the pill once each time the provider transitions to `synced`
  // (e.g. after a snapshot finishes). The class is removed automatically when
  // the animation ends so re-application on the next sync re-triggers it.
  const prevStatusRef = useRef(snap.status);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (snap.status === "synced" && prevStatusRef.current !== "synced") {
      setPulse(true);
    }
    prevStatusRef.current = snap.status;
  }, [snap.status, snap.lastSnapshotAt]);
  const label = useMemo(() => {
    switch (snap.status) {
      case "synced":   return t("sync.label.synced");
      case "syncing":  return t("sync.label.syncing");
      case "conflict": return t("sync.label.conflict");
      case "error":    return t("sync.label.error");
      case "offline":  return t("sync.label.offline");
    }
  }, [snap.status, t]);

  const tooltipText = useMemo(() => {
    switch (snap.status) {
      case "synced":
        return snap.lastSnapshotAt
          ? t("sync.tooltip.synced_at", { when: relTime(t, now - snap.lastSnapshotAt) })
          : t("sync.label.synced");
      case "syncing":
        return t("sync.tooltip.syncing", { bytes: snap.pendingBytes });
      case "conflict": return t("sync.tooltip.conflict");
      case "error":    return snap.lastErrorMessage ?? t("sync.label.error");
      case "offline":  return t("sync.tooltip.offline");
    }
  }, [snap, t, now]);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              onAnimationEnd={() => setPulse(false)}
              className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent ${cls} ${pulse ? "animate-sync-pulse" : ""}`}
            >
              <Icon className={`h-3 w-3 ${spin ? "animate-spin" : ""}`} />
              <span>{label}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipText}</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-72 text-xs">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Icon className={`h-3.5 w-3.5 ${cls} ${spin ? "animate-spin" : ""}`} />
            <span className={`font-medium ${cls}`}>{label}</span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>{t("sync.detail.pending")}</dt>
            <dd className="font-mono text-foreground">{snap.pendingBytes} B</dd>
            <dt>{t("sync.detail.last_broadcast")}</dt>
            <dd className="font-mono text-foreground">
              {snap.lastBroadcastAt
                ? relTime(t, now - snap.lastBroadcastAt)
                : t("sync.detail.never")}
            </dd>
            <dt>{t("sync.detail.last_snapshot")}</dt>
            <dd className="font-mono text-foreground">
              {snap.lastSnapshotAt
                ? relTime(t, now - snap.lastSnapshotAt)
                : t("sync.detail.never")}
            </dd>
          </dl>

          {snap.lastErrorMessage && (
            <div className="rounded border border-destructive/30 bg-destructive/5 p-2">
              <div className="font-medium text-destructive">{t("sync.detail.error_label")}</div>
              <div className="mt-0.5 break-all text-muted-foreground">{snap.lastErrorMessage}</div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-6 px-2 text-xs"
                onClick={snap.dismissError}
              >
                {t("sync.action.dismiss")}
              </Button>
            </div>
          )}

          {snap.conflictPending && !snap.lastErrorMessage && (
            <div className="rounded border border-warning/30 bg-warning/5 p-2">
              <div className="text-muted-foreground">{t("sync.detail.conflict_hint")}</div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-6 px-2 text-xs"
                onClick={snap.dismissConflict}
              >
                {t("sync.action.dismiss")}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
