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

interface RotatePassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionToken: string;
  onSuccess: () => void;
}

export function RotatePassDialog({
  open,
  onOpenChange,
  sessionToken,
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
    if (newPass.length < 12) {
      toast({ title: t("admin.rotate.too_short"), variant: "destructive" });
      return;
    }
    if (newPass !== confirm) {
      toast({ title: t("admin.rotate.mismatch"), variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-rotate", {
        body: { newPass },
        headers: { "x-admin-session": sessionToken },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: t("admin.rotate.success") });
      onSuccess();
      reset();
      onOpenChange(false);
    } catch (error) {
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
              minLength={12}
              required
            />
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

