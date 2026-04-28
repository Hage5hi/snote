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
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getShareToken, setShareToken, clearShareToken } from "@/lib/share-tokens";

interface ShareDialogProps {
  slug: string;
  isEncrypted: boolean;
}

export function ShareDialog({ slug, isEncrypted }: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [url, setUrl] = useState<string>("");

  const [shareToken, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [includeKey, setIncludeKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fullUrl = window.location.href;
    setUrl(fullUrl);
    QRCode.toDataURL(fullUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setDataUrl)
      .catch((e) => {
        console.warn("QR generation failed", e);
        toast({ title: "Không tạo được QR", description: String(e) });
      });
    setToken(getShareToken(slug));
  }, [open, slug]);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url);
    toast({ title: "Đã copy URL" });
  };

  const hasKey = url.includes("#");

  const shareUrl = (() => {
    if (!shareToken) return "";
    const base = `${window.location.origin}/s/${shareToken}`;
    if (isEncrypted && includeKey && hasKey) {
      return base + window.location.hash;
    }
    return base;
  })();

  const createLink = async () => {
    setBusy("create");
    try {
      const { data, error } = await supabase.functions.invoke<{ token: string }>(
        "share-create",
        { body: { slug } },
      );
      if (error || !data?.token) throw error ?? new Error("no token");
      setShareToken(slug, data.token);
      setToken(data.token);
      toast({ title: "Đã tạo link chỉ đọc" });
    } catch (e) {
      console.error(e);
      toast({ title: "Tạo link thất bại", description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const revokeLink = async () => {
    if (!shareToken) return;
    setBusy("revoke");
    try {
      const { error } = await supabase.functions.invoke("share-revoke", {
        body: { token: shareToken },
      });
      if (error) throw error;
      clearShareToken(slug);
      setToken(null);
      toast({ title: "Đã thu hồi link" });
    } catch (e) {
      console.error(e);
      toast({ title: "Thu hồi thất bại", description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    toast({ title: "Đã copy link chỉ đọc" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Share QR"
          title="Share QR code"
        >
          <Share2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share note</DialogTitle>
          <DialogDescription>
            Quét QR bằng điện thoại để mở note nhanh, hoặc tạo link chỉ đọc bên dưới.
            {isEncrypted && hasKey && (
              <span className="mt-1 flex items-center gap-1 text-warning">
                <Lock className="h-3 w-3" />
                URL có chứa key giải mã (#) — chỉ chia sẻ với người bạn tin tưởng.
              </span>
            )}
            {isEncrypted && !hasKey && (
              <span className="mt-1 block text-muted-foreground">
                URL không chứa key — người nhận cần biết key để mở.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {dataUrl ? (
            <div className="rounded-md border border-border bg-white p-2">
              <img src={dataUrl} alt="QR code" className="h-48 w-48" />
            </div>
          ) : (
            <div className="h-48 w-48 animate-pulse rounded-md bg-muted" />
          )}

          <div className="flex w-full items-center gap-2 min-w-0">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs">
              {url}
            </code>
            <Button variant="outline" size="sm" onClick={copyUrl} className="shrink-0">
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
        </div>

        <div className="mt-2 border-t border-border pt-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
            <Eye className="h-3.5 w-3.5" />
            Link chỉ đọc
          </div>
          {!shareToken ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Người nhận chỉ xem được nội dung, không sửa hoặc biết slug gốc.
              </p>
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
                Tạo link chỉ đọc
              </Button>
            </>
          ) : (
            <>
              <div className="flex w-full items-center gap-2 min-w-0">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs">
                  {shareUrl}
                </code>
                <Button variant="outline" size="sm" onClick={copyShareUrl} className="shrink-0">
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              {isEncrypted && hasKey && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={includeKey}
                    onChange={(e) => setIncludeKey(e.target.checked)}
                  />
                  Gắn khoá giải mã vào link (người nhận không cần nhập)
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
                Thu hồi link
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
