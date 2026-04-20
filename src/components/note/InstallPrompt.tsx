import { forwardRef, useEffect, useState } from "react";
import { Download, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "notes:install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS legacy
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export const InstallPrompt = forwardRef<HTMLDivElement>((_props, _ref) => {
  const [dismissed, setDismissed] = useState(true);
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform] = useState(() => detectPlatform());

  useEffect(() => {
    if (isStandalone()) return;
    if (typeof window === "undefined") return;
    const wasDismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    if (wasDismissed) return;
    setDismissed(false);

    const onBip = (e: Event) => {
      e.preventDefault();
      setBipEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (dismissed || isStandalone()) return null;
  // On desktop without a bip event, no point showing the prompt.
  if (platform === "desktop" && !bipEvent) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!bipEvent) return;
    await bipEvent.prompt();
    await bipEvent.userChoice;
    dismiss();
  };

  return (
    <div className="mt-6 flex items-start gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
        <Smartphone className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Cài đặt như một app</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {platform === "ios" && (
            <>
              Bấm <Share className="inline h-3 w-3 align-[-2px]" /> Share, sau đó chọn{" "}
              <span className="font-medium">"Add to Home Screen"</span>.
            </>
          )}
          {platform === "android" && bipEvent && (
            <>Cài Notes vào màn hình chính, mở nhanh không cần thanh URL.</>
          )}
          {platform === "android" && !bipEvent && (
            <>
              Mở menu trình duyệt, chọn <span className="font-medium">"Add to Home Screen"</span> hoặc{" "}
              <span className="font-medium">"Install app"</span>.
            </>
          )}
          {platform === "desktop" && bipEvent && (
            <>Cài Notes thành ứng dụng độc lập trên máy tính.</>
          )}
        </p>
        {bipEvent && (
          <Button size="sm" className="mt-2 h-7" onClick={install}>
            <Download className="h-3.5 w-3.5" />
            Cài đặt
          </Button>
        )}
      </div>
      <button
        aria-label="Đóng"
        onClick={dismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

InstallPrompt.displayName = "InstallPrompt";
