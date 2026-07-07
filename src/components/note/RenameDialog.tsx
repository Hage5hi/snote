import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  clearRenamedSlugLocalState,
  prepareRename,
  finalizeRename,
  waitForSlugDeletionConfirmed,
  SLUG_RE,
} from "@/lib/rename";
import { fetchOldSlugCleanupStatus } from "@/lib/rename-cleanup-status";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/index";
import type { SupabaseYjsProvider } from "@/lib/yjs/provider";

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSlug: string;
  provider?: SupabaseYjsProvider | null;
}

type Status = "idle" | "checking" | "available" | "taken" | "invalid" | "same";

export function RenameDialog({ open, onOpenChange, currentSlug, provider }: RenameDialogProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [cleanupState, setCleanupState] = useState<"idle" | "checking" | "clean" | "dirty">("idle");
  const [cleanupDetail, setCleanupDetail] = useState<string>("");

  useEffect(() => {
    if (open) {
      setValue("");
      setStatus("idle");
      setSubmitting(false);
      setCleanupState("idle");
      setCleanupDetail("");
    }
  }, [open]);

  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setStatus("idle");
      return;
    }
    if (trimmed === currentSlug) {
      setStatus("same");
      return;
    }
    if (!SLUG_RE.test(trimmed)) {
      setStatus("invalid");
      return;
    }
    setStatus("checking");
    const ctrl = new AbortController();
    const tm = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("slug, char_count")
        .eq("slug", trimmed)
        .abortSignal(ctrl.signal)
        .maybeSingle();
      if (ctrl.signal.aborted) return;
      if (error) {
        setStatus("idle");
        return;
      }
      if (!data || (data.char_count ?? 0) === 0) setStatus("available");
      else setStatus("taken");
    }, 350);
    return () => {
      ctrl.abort();
      window.clearTimeout(tm);
    };
  }, [value, currentSlug]);

  const canSubmit = status === "available" && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    const newSlug = value.trim();
    setSubmitting(true);
    setCleanupState("checking");
    setCleanupDetail("");
    try {
      await provider?.saveSnapshot();
      await prepareRename(currentSlug, newSlug);
      // Navigate FIRST so the old NotePage unmounts and its Yjs provider
      // stops upserting `ydoc_state` for currentSlug — otherwise a debounced
      // snapshot would recreate the old row after we delete it.
      navigate(`/${newSlug}`);
      // Give React a tick to unmount, then delete the source row.
      await new Promise((r) => setTimeout(r, 50));
      await clearRenamedSlugLocalState(currentSlug);
      const { deletionConfirmed } = await finalizeRename(currentSlug, newSlug);
      const cleanupStatus = await fetchOldSlugCleanupStatus(currentSlug).catch(() => null);
      const finalDeletionConfirmed = deletionConfirmed || cleanupStatus?.cleaned || (await waitForSlugDeletionConfirmed(currentSlug)).deleted;
      setCleanupState(finalDeletionConfirmed ? "clean" : "dirty");
      if (cleanupStatus) {
        const { providerAbandoned, docCacheWarm, sessionSnapshotPresent, indexedDbCleared } = cleanupStatus.clientSignals ?? {};
        setCleanupDetail(
          `db=${cleanupStatus.database.rowPresent ? "present" : "gone"}` +
            ` · provider=${providerAbandoned ? "abandoned" : "live"}` +
            ` · doc-cache=${docCacheWarm ? "warm" : "cold"}` +
            ` · session=${sessionSnapshotPresent ? "present" : "gone"}` +
            ` · idb=${indexedDbCleared ? "cleared" : "unknown"}`,
        );
      }
      toast({
        title: t("rename.toast_renamed"),
        description: finalDeletionConfirmed
          ? `/${currentSlug} → /${newSlug}`
          : `/${currentSlug} → /${newSlug} (old slug still present — retry)`,
        variant: finalDeletionConfirmed ? undefined : "destructive",
      });
      if (finalDeletionConfirmed) onOpenChange(false);
      else setSubmitting(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("rename.generic_error");
      toast({ title: t("rename.toast_failed"), description: msg, variant: "destructive" });
      setCleanupState("idle");
      setSubmitting(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("rename.dialog_title")}</DialogTitle>
          <DialogDescription>
            {t("rename.dialog_desc_prefix")} <code className="font-mono">/{currentSlug}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
              /
            </span>
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKey}
              placeholder={t("rename.placeholder")}
              className="pl-6 pr-9 font-mono"
              disabled={submitting}
              maxLength={64}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {status === "checking" && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {status === "available" && <Check className="h-4 w-4 text-primary" />}
              {(status === "taken" || status === "invalid" || status === "same") && (
                <X className="h-4 w-4 text-destructive" />
              )}
            </div>
          </div>

          <div className="min-h-[1.25rem] text-xs">
            {status === "invalid" && <span className="text-destructive">{t("rename.invalid")}</span>}
            {status === "taken" && <span className="text-destructive">{t("rename.taken")}</span>}
            {status === "same" && <span className="text-muted-foreground">{t("rename.same")}</span>}
            {status === "available" && <span className="text-primary">{t("rename.available")}</span>}
          </div>

          <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-foreground/70" />
            <div className="space-y-1">
              <p>{t("rename.warn_old_url", { slug: currentSlug })}</p>
              <p>{t("rename.warn_other_tabs")}</p>
            </div>
          </div>

          {cleanupState !== "idle" && (
            <div
              role="status"
              aria-live="polite"
              data-testid="rename-cleanup-status"
              data-cleanup-state={cleanupState}
              className={
                "rounded-md border p-3 text-xs " +
                (cleanupState === "clean"
                  ? "border-primary/40 bg-primary/5 text-primary"
                  : cleanupState === "dirty"
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "border-border bg-muted/40 text-muted-foreground")
              }
            >
              <p className="font-medium">
                {cleanupState === "checking" && "Cleaning up old slug…"}
                {cleanupState === "clean" && `Old slug /${currentSlug} fully removed.`}
                {cleanupState === "dirty" && `Old slug /${currentSlug} still present — retry.`}
              </p>
              {cleanupDetail && <p className="mt-1 font-mono opacity-80">{cleanupDetail}</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("rename.cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("rename.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
