import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Loader2, X } from "lucide-react";
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
import { duplicateNote, SLUG_RE } from "@/lib/rename";
import { toast } from "@/hooks/use-toast";

interface DuplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSlug: string;
}

type Status = "idle" | "checking" | "available" | "taken" | "invalid" | "same";

/**
 * Duplicate the current note to a new slug. Source note stays intact.
 * For encrypted notes, the same password unlocks the duplicate (salt + check
 * are copied verbatim).
 */
export function DuplicateDialog({ open, onOpenChange, currentSlug }: DuplicateDialogProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
      setStatus("idle");
      setSubmitting(false);
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
    const t = window.setTimeout(async () => {
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
      window.clearTimeout(t);
    };
  }, [value, currentSlug]);

  const canSubmit = status === "available" && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    const newSlug = value.trim();
    setSubmitting(true);
    try {
      await duplicateNote(currentSlug, newSlug);
      toast({
        title: "Đã duplicate note",
        description: `/${currentSlug} → /${newSlug}`,
      });
      onOpenChange(false);
      navigate(`/${newSlug}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Có lỗi xảy ra";
      toast({ title: "Duplicate thất bại", description: msg, variant: "destructive" });
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
          <DialogTitle>Duplicate note</DialogTitle>
          <DialogDescription>
            Copy nội dung từ <code className="font-mono">/{currentSlug}</code> sang slug mới. Note
            gốc giữ nguyên.
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
              placeholder="slug-moi"
              className="pl-6 pr-9 font-mono"
              disabled={submitting}
              maxLength={64}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {status === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {status === "available" && <Check className="h-4 w-4 text-primary" />}
              {(status === "taken" || status === "invalid" || status === "same") && (
                <X className="h-4 w-4 text-destructive" />
              )}
            </div>
          </div>

          <div className="min-h-[1.25rem] text-xs">
            {status === "invalid" && (
              <span className="text-destructive">
                Chỉ dùng chữ, số, gạch ngang/dưới (1–64 ký tự).
              </span>
            )}
            {status === "taken" && <span className="text-destructive">Slug này đã được dùng.</span>}
            {status === "same" && <span className="text-muted-foreground">Trùng với slug nguồn.</span>}
            {status === "available" && <span className="text-primary">Slug khả dụng.</span>}
          </div>

          <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Copy className="h-4 w-4 shrink-0 text-foreground/70" />
            <div className="space-y-1">
              <p>Bản sao kế thừa cả tags và trạng thái mã hoá.</p>
              <p>
                Note đã encrypt sẽ unlock được bằng cùng password ở slug mới.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
