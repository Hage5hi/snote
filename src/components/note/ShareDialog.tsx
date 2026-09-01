import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Share2, Copy, Lock, Eye, Link2Off, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getShareToken, clearShareToken } from "@/lib/share-tokens";
import { useI18n } from "@/i18n/index";
import {
  buildCapabilityUrl,
  buildCurrentEditShareUrl,
  CAPABILITY_TOKEN_RE,
  readEncryptionSecret,
  type CapabilityAccess,
} from "@/lib/capability/url";

const loadCapabilityApi = import.meta.env.VITE_CAPABILITY_ROUTES_ENABLED === "true"
  ? async () => (await import("@/lib/capability/client")).createCapabilityApi()
  : async () => {
      throw new Error("capability API unavailable");
    };

interface ShareDialogProps {
  slug: string;
  isEncrypted: boolean;
  capabilityAccess?: CapabilityAccess | null;
  currentShareUrl?: string;
}

export function ShareDialog({
  slug,
  isEncrypted,
  capabilityAccess = null,
  currentShareUrl,
}: ShareDialogProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [url, setUrl] = useState<string>("");

  const [shareToken, setToken] = useState<string | null>(null);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "revoke" | "create-edit" | "revoke-edit" | null>(null);
  const [includeKey, setIncludeKey] = useState(false);

  const encryptionSecret = readEncryptionSecret(window.location.hash);
  const hasKey = !!encryptionSecret;

  useEffect(() => {
    if (!open) return;
    const fullUrl = capabilityAccess
      ? buildCurrentEditShareUrl(capabilityAccess, slug, encryptionSecret) ?? ""
      : currentShareUrl ?? window.location.href;
    setUrl(fullUrl);
    setDataUrl("");
    setEditToken(null);
    setToken(capabilityAccess ? null : getShareToken(slug));
  }, [open, slug, capabilityAccess, encryptionSecret, currentShareUrl]);

  const editUrl = capabilityAccess?.scope === "owner" && editToken
    ? buildCapabilityUrl(
      "edit",
      editToken,
      slug,
      isEncrypted && includeKey ? encryptionSecret : undefined,
    )
    : "";
  const displayedUrl = editUrl || url;

  useEffect(() => {
    if (!open || !displayedUrl) {
      setDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(displayedUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((nextDataUrl) => {
        if (!cancelled) setDataUrl(nextDataUrl);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("QR generation failed", e);
        toast({ title: t("share.qr_failed"), description: String(e) });
      });
    return () => { cancelled = true; };
  }, [open, displayedUrl, t]);

  const copyUrl = async () => {
    if (!displayedUrl) return;
    await navigator.clipboard.writeText(displayedUrl);
    toast({ title: t("share.copied_url") });
  };

  const shareUrl = (() => {
    if (!shareToken) return "";
    if (capabilityAccess) {
      return buildCapabilityUrl(
        "view",
        shareToken,
        undefined,
        isEncrypted && includeKey ? encryptionSecret : undefined,
      );
    }
    const base = `${window.location.origin}/s/${shareToken}`;
    if (isEncrypted && includeKey && hasKey) {
      return `${base}#${encodeURIComponent(encryptionSecret)}`;
    }
    return base;
  })();

  const createLink = async () => {
    if (capabilityAccess?.scope !== "owner") return;
    setBusy("create");
    try {
      const data = await (await loadCapabilityApi()).manage(capabilityAccess.token, {
        action: "rotate",
        scope: "view",
      });
      const rotated = data.rotated as { scope?: unknown; capability?: unknown } | undefined;
      if (
        rotated?.scope !== "view"
        || typeof rotated.capability !== "string"
        || !CAPABILITY_TOKEN_RE.test(rotated.capability)
      ) {
        throw new Error("invalid rotated capability");
      }
      setToken(rotated.capability);
      toast({ title: t("share.created_link") });
    } catch (e) {
      console.error(e);
      toast({ title: t("share.create_failed"), description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const createEditLink = async () => {
    if (capabilityAccess?.scope !== "owner") return;
    setBusy("create-edit");
    try {
      const data = await (await loadCapabilityApi()).manage(capabilityAccess.token, {
        action: "rotate",
        scope: "edit",
      });
      const rotated = data.rotated as { scope?: unknown; capability?: unknown } | undefined;
      if (
        rotated?.scope !== "edit"
        || typeof rotated.capability !== "string"
        || !CAPABILITY_TOKEN_RE.test(rotated.capability)
      ) {
        throw new Error("invalid rotated capability");
      }
      setEditToken(rotated.capability);
      toast({ title: t("share.edit_created") });
    } catch (e) {
      console.error(e);
      toast({ title: t("share.create_failed"), description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const revokeEditLink = async () => {
    if (capabilityAccess?.scope !== "owner" || !editToken) return;
    setBusy("revoke-edit");
    try {
      await (await loadCapabilityApi()).manage(capabilityAccess.token, {
        action: "rotate",
        scope: "edit",
      });
      setEditToken(null);
      setUrl("");
      toast({ title: t("share.revoked") });
    } catch (e) {
      console.error(e);
      toast({ title: t("share.revoke_failed"), description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const revokeLink = async () => {
    if (!shareToken) return;
    setBusy("revoke");
    try {
      if (capabilityAccess) {
        if (capabilityAccess.scope !== "owner") throw new Error("owner capability required");
        // Rotation revokes the displayed capability immediately. The newly
        // minted replacement is deliberately discarded until the user asks
        // to create a fresh link.
        await (await loadCapabilityApi()).manage(capabilityAccess.token, {
          action: "rotate",
          scope: "view",
        });
        setToken(null);
        toast({ title: t("share.revoked") });
        return;
      }
      const { error } = await supabase.functions.invoke("share-revoke", { body: { token: shareToken } });
      if (error) throw error;
      clearShareToken(slug);
      setToken(null);
      toast({ title: t("share.revoked") });
    } catch (e) {
      console.error(e);
      toast({ title: t("share.revoke_failed"), description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    toast({ title: t("share.copied_readonly_link") });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("share.aria")}>
              <Share2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("share.tooltip")}</TooltipContent>
      </Tooltip>
      <DialogContent className="min-w-0 max-h-[calc(100vh-2rem)] !w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle>{t("share.dialog_title")}</DialogTitle>
          <DialogDescription className="min-w-0 leading-relaxed">
            {t("share.dialog_desc")}
            {isEncrypted && hasKey && (
              <span className="mt-1 flex items-center gap-1 text-warning">
                <Lock className="h-3 w-3" />
                {t("share.warn_key_in_url")}
              </span>
            )}
            {isEncrypted && !hasKey && (
              <span className="mt-1 block text-muted-foreground">{t("share.no_key")}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="w-full min-w-0 overflow-hidden">
          {dataUrl && displayedUrl ? (
            <div className="mx-auto w-fit max-w-full rounded-md border border-border bg-white p-2">
              <img src={dataUrl} alt="QR code" className="h-48 w-48 max-w-full" />
            </div>
          ) : displayedUrl ? (
            <div className="mx-auto h-48 w-48 max-w-full animate-pulse rounded-md bg-muted" />
          ) : (
            <div className="mx-auto flex h-48 w-48 max-w-full items-center justify-center rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              {t("share.collaborator_desc")}
            </div>
          )}

          {displayedUrl && <div className="mt-3 flex w-full max-w-full min-w-0 items-center gap-2 overflow-hidden">
            <code
              className="block w-0 min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs"
              dir="ltr"
            >
              {displayedUrl}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={copyUrl}
              className="h-9 w-9 shrink-0"
              aria-label={t("brand.copy_url")}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>}
        </div>

        {capabilityAccess?.scope === "owner" && (
          <div className="mt-2 min-w-0 border-t border-border pt-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
              <Share2 className="h-3.5 w-3.5" />
              {t("share.collaborator_heading")}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">{t("share.collaborator_desc")}</p>
            {!editToken ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={createEditLink}
                disabled={busy === "create-edit"}
              >
                {busy === "create-edit" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("share.create_edit_btn")}
              </Button>
            ) : (
              <div className="space-y-2">
                {isEncrypted && hasKey && (
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={includeKey}
                      onChange={(event) => setIncludeKey(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>{t("share.include_key")}</span>
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={copyUrl}>
                    <Copy className="h-3.5 w-3.5" />
                    {t("share.copy_edit_link")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={revokeEditLink}
                    disabled={busy === "revoke-edit"}
                  >
                    {busy === "revoke-edit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />}
                    {t("share.revoke_btn")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {(capabilityAccess?.scope === "owner" || (!capabilityAccess && shareToken)) && (
        <div className="mt-2 min-w-0 border-t border-border pt-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
            <Eye className="h-3.5 w-3.5" />
            {t("share.readonly_heading")}
          </div>
          {!shareToken ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{t("share.readonly_desc")}</p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={createLink}
                disabled={busy === "create"}
              >
                {busy === "create" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {t("share.create_btn")}
              </Button>
            </>
          ) : (
            <>
              <div className="flex w-full max-w-full min-w-0 items-center gap-2 overflow-hidden">
                <code
                  className="block w-0 min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs"
                  dir="ltr"
                >
                  {shareUrl}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyShareUrl}
                  className="h-9 w-9 shrink-0"
                  aria-label={t("share.copied_readonly_link")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              {isEncrypted && hasKey && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={includeKey}
                    onChange={(e) => setIncludeKey(e.target.checked)}
                  />
                  {t("share.include_key")}
                </label>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-7 w-full text-xs text-destructive hover:text-destructive"
                onClick={revokeLink}
                disabled={busy === "revoke"}
              >
                {busy === "revoke" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2Off className="h-3.5 w-3.5" />
                )}
                {t("share.revoke_btn")}
              </Button>
            </>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
