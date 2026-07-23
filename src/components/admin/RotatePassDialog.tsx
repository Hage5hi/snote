import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/index";
import { isValidAdminPassphrase } from "../../../supabase/functions/_shared/admin-passphrase";

interface RotatePassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionToken: string;
  sessionGeneration: number;
  validateSession: (token: string, generation: number) => boolean;
  onUnauthorized: (rejectedToken: string, generation: number) => boolean;
  onSuccess: (rotatedToken: string, generation: number) => boolean;
}

function isUnauthorizedAdminResponse(error: unknown, data: unknown): boolean {
  const candidate = error && typeof error === "object"
    ? error as { status?: unknown; context?: { status?: unknown } }
    : null;
  const directStatus = Number(candidate?.status);
  const contextStatus = Number(candidate?.context?.status);
  const status = Number.isFinite(contextStatus) ? contextStatus : directStatus;
  const apiError = data && typeof data === "object" && "error" in data
    ? String((data as { error?: unknown }).error ?? "").trim().toLowerCase()
    : "";
  const message = String((error as { message?: unknown } | null)?.message ?? "")
    .toLowerCase();
  return status === 401 || status === 403 ||
    /^(unauthorized|session (expired|invalid))$/.test(apiError) ||
    message.includes("unauthorized") || message.includes("session expired");
}

export function RotatePassDialog({
  open,
  onOpenChange,
  sessionToken,
  sessionGeneration,
  validateSession,
  onUnauthorized,
  onSuccess,
}: RotatePassDialogProps) {
  const { t } = useI18n();
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setNewPass("");
    setConfirm("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidAdminPassphrase(newPass)) {
      toast({ title: t("admin.rotate.invalid_length"), variant: "destructive" });
      return;
    }
    if (newPass !== confirm) {
      toast({ title: t("admin.rotate.mismatch"), variant: "destructive" });
      return;
    }
    if (!validateSession(sessionToken, sessionGeneration)) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-rotate", {
        body: { newPass },
        headers: { "x-admin-session": sessionToken },
      });
      if (isUnauthorizedAdminResponse(error, data)) {
        if (onUnauthorized(sessionToken, sessionGeneration)) {
          toast({
            title: t("admin.rotate.failed"),
            description: "Session expired.",
            variant: "destructive",
          });
        }
        return;
      }
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!onSuccess(sessionToken, sessionGeneration)) return;
      toast({ title: t("admin.rotate.success") });
      reset();
      onOpenChange(false);
    } catch (error) {
      if (isUnauthorizedAdminResponse(error, null)) {
        if (onUnauthorized(sessionToken, sessionGeneration)) {
          toast({
            title: t("admin.rotate.failed"),
            description: "Session expired.",
            variant: "destructive",
          });
        }
        return;
      }
      toast({
        title: t("admin.rotate.failed"),
        description: String((error as Error | undefined)?.message ?? error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.rotate.title")}</DialogTitle>
          <DialogDescription>{t("admin.rotate.desc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="newPass">{t("admin.rotate.new_label")}</Label>
            <Input
              id="newPass"
              type="password"
              autoComplete="new-password"
              value={newPass}
              onChange={(event) => setNewPass(event.target.value)}
              placeholder={t("admin.rotate.new_placeholder")}
              required
            />
            <p className="text-xs text-muted-foreground">12–72 UTF-8 bytes</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">{t("admin.rotate.confirm_label")}</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t("admin.rotate.cancel")}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("admin.rotate.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

