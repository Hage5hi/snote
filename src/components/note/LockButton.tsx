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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  deriveKey,
  encryptBytes,
  generatePassphrase,
  makeCheck,
  randomSalt,
  PBKDF2_ITERATIONS,
} from "@/lib/crypto";
import { bytesToBase64 } from "@/lib/yjs/base64";
import { useI18n } from "@/i18n/index";
import { clearNoteEncryptionPin, markNoteEncrypted } from "@/lib/encryption-pin";

interface LockButtonProps {
  slug: string;
  doc: Y.Doc;
  isEncrypted: boolean;
}

export function LockButton({ slug, doc, isEncrypted }: LockButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const currentKey =
    typeof window !== "undefined" && window.location.hash.startsWith("#")
      ? decodeURIComponent(window.location.hash.slice(1))
      : "";

  const copyKey = async () => {
    if (!currentKey) {
      toast({ title: t("lock.no_key_in_url") });
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}/${slug}#${currentKey}`);
    toast({ title: t("lock.copied_url_key") });
  };

  const lockNote = async (passphrase: string) => {
    setBusy(true);
    try {
      const salt = randomSalt();
      const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
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
            enc_iterations: PBKDF2_ITERATIONS,
            ydoc_state: bytesToBase64(encrypted),
            content: "",
            char_count: 0,
          },
          { onConflict: "slug" },
        );
      if (error) throw error;

      // The durable local pin closes the legacy-table downgrade window. It is
      // written only after the encrypted upsert succeeds and before reload.
      markNoteEncrypted(slug);
      toast({ title: t("lock.encrypted_ok") });
      // Full navigation (not just hash change) so NotePage remounts and the
      // Yjs provider is rebuilt with the new encryption state. Otherwise the
      // stale provider keeps writing in the previous mode and corrupts the row.
      window.location.href = `/${slug}#${encodeURIComponent(passphrase)}`;
      window.location.reload();
    } catch (e) {
      console.error(e);
      toast({
        title: t("lock.encrypt_failed"),
        description: String((e as Error | undefined)?.message ?? e),
        variant: "destructive",
      });
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
          { onConflict: "slug" },
        );
      if (error) throw error;

      // A failed decrypt must retain the pin. Clear it only after the server
      // acknowledges the explicit transition back to plaintext.
      clearNoteEncryptionPin(slug);
      toast({ title: t("lock.decrypted_ok") });
      // Full reload so the provider re-initializes without the stale
      // encryption key and future saves don't clobber the row.
      window.location.href = `/${slug}`;
      window.location.reload();
    } catch (e) {
      console.error(e);
      toast({
        title: t("lock.decrypt_failed"),
        description: String((e as Error | undefined)?.message ?? e),
        variant: "destructive",
      });
      setBusy(false);
    }
  };

  if (isEncrypted) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("lock.aria_encryption")}>
                <Lock className="h-4 w-4 text-success" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("lock.encrypted_tooltip")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={copyKey}>
            <Copy className="h-3.5 w-3.5" />
            {t("lock.copy_url_key")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={unlockNote} disabled={busy}>
            <LockOpen className="h-3.5 w-3.5" />
            {t("lock.unlock")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPass("");
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("lock.aria_encrypt")}>
              <LockOpen className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("lock.tooltip_encrypt")}</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {t("lock.dialog_title")}
          </DialogTitle>
          <DialogDescription>{t("lock.dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={t("lock.placeholder")}
            type="text"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPass(generatePassphrase(24))}
          >
            <RotateCw className="h-3.5 w-3.5" />
            {t("lock.generate")}
          </Button>
          <p className="text-[11px] text-muted-foreground">{t("lock.warning")}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("lock.cancel")}
          </Button>
          <Button onClick={() => lockNote(pass)} disabled={busy || pass.length < 4}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("lock.encrypt_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
