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

interface RotatePassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPass: string;
  onSuccess: (newPass: string) => void;
}

export function RotatePassDialog({
  open,
  onOpenChange,
  currentPass,
  onSuccess,
}: RotatePassDialogProps) {
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setNewPass("");
    setConfirm("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.length < 12) {
      toast({ title: "Khoá mới phải ≥ 12 ký tự.", variant: "destructive" });
      return;
    }
    if (newPass !== confirm) {
      toast({ title: "Xác nhận không khớp.", variant: "destructive" });
      return;
    }
    if (newPass === currentPass) {
      toast({ title: "Khoá mới phải khác khoá cũ.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-rotate", {
        body: { currentPass, newPass },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Đã đổi khoá admin." });
      onSuccess(newPass);
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Đổi khoá thất bại",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Đổi khoá admin</DialogTitle>
          <DialogDescription>
            Khoá mới sẽ được lưu hash bcrypt trên server. Tối thiểu 12 ký tự.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="newPass">Khoá mới</Label>
            <Input
              id="newPass"
              type="password"
              autoComplete="new-password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="≥ 12 ký tự"
              minLength={12}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Xác nhận khoá mới</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
              Huỷ
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Đổi khoá
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
