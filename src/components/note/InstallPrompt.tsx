import { forwardRef, useEffect, useState } from "react";
import { Download, Puzzle, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/index";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
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
  const { t } = useI18n();
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform] = useState(() => detectPlatform());
  const [standalone, setStandalone] = useState(() => isStandalone());
  const [appOpen, setAppOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);

  useEffect(() => {
    if (standalone) return;
    const onBip = (e: Event) => {
      e.preventDefault();
      setBipEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const onMq = () => setStandalone(isStandalone());
    mq?.addEventListener?.("change", onMq);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      mq?.removeEventListener?.("change", onMq);
    };
  }, [standalone]);

  if (standalone) return null;

  const install = async () => {
    if (!bipEvent) return;
    await bipEvent.prompt();
    await bipEvent.userChoice;
    setBipEvent(null);
    setAppOpen(false);
  };

  const downloadExtension = () => {
    fetch("/syrin-note-sidepanel.zip")
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "syrin-note-sidepanel.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => alert(err.message));
  };

  const appHint = (
    <>
      {platform === "ios" && (
        <>
          {t("install.ios_hint_prefix")} <Share className="inline h-3 w-3 align-[-2px]" />{" "}
          {t("install.ios_hint_suffix")}{" "}
          <span className="font-medium">"{t("install.ios_add")}"</span>.
        </>
      )}
      {platform === "android" && bipEvent && <>{t("install.android_with_bip")}</>}
      {platform === "android" && !bipEvent && (
        <>
          {t("install.android_no_bip_prefix")}{" "}
          <span className="font-medium">"{t("install.ios_add")}"</span>{" "}
          {t("install.android_no_bip_or")}{" "}
          <span className="font-medium">"{t("install.android_no_bip_install")}"</span>.
        </>
      )}
      {platform === "desktop" && bipEvent && <>{t("install.desktop_with_bip")}</>}
      {platform === "desktop" && !bipEvent && <>{t("install.desktop_no_bip")}</>}
    </>
  );

  return (
    <div className="mx-auto mt-6 grid w-full max-w-md grid-cols-2 gap-2 rounded-md border border-border bg-card p-2">
      {/* Install as an app */}
      <Dialog open={appOpen} onOpenChange={setAppOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <Smartphone className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium">{t("install.title")}</span>
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("install.title")}</DialogTitle>
            <DialogDescription className="text-xs">{appHint}</DialogDescription>
          </DialogHeader>
          {bipEvent && (
            <Button onClick={install} className="w-full">
              <Download className="h-4 w-4" />
              {t("install.btn")}
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* Browser extension */}
      <Dialog open={extOpen} onOpenChange={setExtOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <Puzzle className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium">{t("install.ext_title")}</span>
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("install.ext_title")}</DialogTitle>
            <DialogDescription className="text-xs">{t("install.ext_desc")}</DialogDescription>
          </DialogHeader>
          <Button onClick={downloadExtension} className="w-full">
            <Download className="h-4 w-4" />
            {t("install.ext_download")}
          </Button>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{t("install.ext_step1")}</li>
            <li>{t("install.ext_step2")}</li>
            <li>{t("install.ext_step3")}</li>
            <li>{t("install.ext_step4")}</li>
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
});

InstallPrompt.displayName = "InstallPrompt";
