import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Share2, Copy, Lock } from "lucide-react";
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

interface ShareDialogProps {
  isEncrypted: boolean;
}

export function ShareDialog({ isEncrypted }: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [url, setUrl] = useState<string>("");

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
  }, [open]);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url);
    toast({ title: "Đã copy URL" });
  };

  const hasKey = url.includes("#");

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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share note</DialogTitle>
          <DialogDescription>
            Quét QR bằng điện thoại để mở note nhanh.
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

        <div className="flex flex-col items-center gap-4">
          {dataUrl ? (
            <div className="rounded-md border border-border bg-white p-3">
              <img src={dataUrl} alt="QR code" className="h-64 w-64" />
            </div>
          ) : (
            <div className="h-64 w-64 animate-pulse rounded-md bg-muted" />
          )}

          <div className="flex w-full items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs">
              {url}
            </code>
            <Button variant="outline" size="sm" onClick={copyUrl}>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
