import { useState } from "react";
import * as Y from "yjs";
import { Lock, LockOpen, KeyRound, Loader2, RotateCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  deriveKey,
  encryptBytes,
  generatePassphrase,
  makeCheck,
  randomSalt,
} from "@/lib/crypto";
import { bytesToBase64 } from "@/lib/yjs/base64";

interface LockButtonProps {
  slug: string;
  doc: Y.Doc;
  isEncrypted: boolean;
}

/**
 * LockButton handles three operations:
 *  - Lock an unencrypted note (generate or accept a key, encrypt + upload, redirect with #key)
 *  - Copy the current key from the URL hash
 *  - Unlock (decrypt + upload plaintext, strip the hash)
 *
 * The destroy/recreate of the provider is handled by reloading the page after upload —
 * simpler and bullet-proof vs trying to mutate a live provider's encryption hooks.
 */
export function LockButton({ slug, doc, isEncrypted }: LockButtonProps) {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const currentKey =
    typeof window !== "undefined" && window.location.hash.startsWith("#")
      ? decodeURIComponent(window.location.hash.slice(1))
      : "";

  const copyKey = async () => {
    if (!currentKey) {
      toast({ title: "Chưa có khoá trong URL" });
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}/${slug}#${currentKey}`);
    toast({ title: "Đã copy URL kèm khoá" });
  };

  const lockNote = async (passphrase: string) => {
    setBusy(true);
    try {
      const salt = randomSalt();
      const key = await deriveKey(passphrase, salt);
      const check = await makeCheck(key);
      const state = Y.encodeStateAsUpdate(doc);
      const encrypted = await encryptBytes(key, state);

      const { error } = await supabase
        .from("notes")
        .upsert(
          {
            slug,
            is_encrypted: true,
            enc_salt: salt,
            enc_check: check,
            ydoc_state: bytesToBase64(encrypted),
            content: "",
            char_count: 0,
          },
          { onConflict: "slug" }
        );
      if (error) throw error;

      toast({ title: "Đã mã hoá note" });
      // Reload with the key in hash so the provider re-mounts with encryption.
      window.location.replace(`/${slug}#${encodeURIComponent(passphrase)}`);
    } catch (e: any) {
      console.error(e);
      toast({ title: "Mã hoá thất bại", description: String(e?.message ?? e), variant: "destructive" });
      setBusy(false);
    }
  };

  const unlockNote = async () => {
    setBusy(true);
    try {
      const text = doc.getText("content").toString();
      const state = Y.encodeStateAsUpdate(doc);
      const { error } = await supabase
        .from("notes")
        .upsert(
          {
            slug,
            is_encrypted: false,
            enc_salt: null,
            enc_check: null,
            ydoc_state: bytesToBase64(state),
            content: text,
            char_count: text.length,
          },
          { onConflict: "slug" }
        );
      if (error) throw error;

      toast({ title: "Đã bỏ mã hoá" });
      window.location.replace(`/${slug}`);
    } catch (e: any) {
      console.error(e);
      toast({ title: "Bỏ mã hoá thất bại", description: String(e?.message ?? e), variant: "destructive" });
      setBusy(false);
    }
  };

  if (isEncrypted) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Encryption" title="Note đã mã hoá">
            <Lock className="h-4 w-4 text-success" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={copyKey}>
            <Copy className="h-3.5 w-3.5" />
            Copy URL kèm khoá
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={unlockNote} disabled={busy}>
            <LockOpen className="h-3.5 w-3.5" />
            Bỏ mã hoá
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPass(""); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mã hoá note" title="Mã hoá note">
          <LockOpen className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Mã hoá note</DialogTitle>
          <DialogDescription>
            Note sẽ được mã hoá AES-256 ngay tại trình duyệt. Chia sẻ URL kèm <code>#khoá</code> để người khác đọc được.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Khoá (passphrase)"
            type="text"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPass(generatePassphrase(24))}
          >
            <RotateCw className="h-3.5 w-3.5" />
            Sinh khoá ngẫu nhiên
          </Button>
          <p className="text-[11px] text-muted-foreground">
            ⚠️ Lưu khoá ở nơi an toàn. Mất khoá = mất nội dung vĩnh viễn (server không có cách khôi phục).
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Huỷ</Button>
          <Button onClick={() => lockNote(pass)} disabled={busy || pass.length < 4}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mã hoá"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
