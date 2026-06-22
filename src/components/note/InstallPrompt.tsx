import { forwardRef, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Download,
  Puzzle,
  Share,
  Smartphone,
} from "lucide-react";
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

type Platform = "ios" | "android" | "desktop";
type Browser = "chromium" | "safari" | "firefox" | "other";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function detectBrowser(): Browser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Edg\/|Chrome\/|Chromium\//.test(ua) && !/OPR\//.test(ua)) return "chromium";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "safari";
  return "other";
}

// Reusable: live 4-step checklist. `done` reflects real-time progress
// (e.g. PWA install events, .zip download completion) plus optional
// user-managed checkmarks persisted in localStorage by the caller.
function StepList({
  steps,
}: {
  steps: { label: string; done: boolean; onToggle?: () => void }[];
}) {
  return (
    <ol className="space-y-1.5 text-xs">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2">
          <button
            type="button"
            onClick={s.onToggle}
            disabled={!s.onToggle}
            className="mt-0.5 shrink-0"
            aria-label={s.done ? "Completed" : "Mark step"}
          >
            {s.done ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <span
            className={`min-w-0 break-words ${s.done ? "text-muted-foreground line-through" : ""}`}
          >
            <span className="font-medium">{i + 1}.</span> {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

const EXT_STEPS_KEY = "install.ext.steps";

function loadExtSteps(): boolean[] {
  if (typeof localStorage === "undefined") return [false, false, false, false];
  try {
    const v = JSON.parse(localStorage.getItem(EXT_STEPS_KEY) || "[]");
    return [0, 1, 2, 3].map((i) => !!v[i]);
  } catch {
    return [false, false, false, false];
  }
}

export const InstallPrompt = forwardRef<HTMLDivElement>((_props, _ref) => {
  const { t } = useI18n();
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform] = useState(() => detectPlatform());
  const [browser] = useState(() => detectBrowser());
  const [standalone, setStandalone] = useState(() => isStandalone());
  const [installed, setInstalled] = useState(false);
  const [promptAccepted, setPromptAccepted] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);
  const [zipDownloaded, setZipDownloaded] = useState(false);
  const [extSteps, setExtSteps] = useState<boolean[]>(() => loadExtSteps());

  // NOTE: this panel is intentionally non-dismissible — no X, no
  // localStorage flag. The two trigger buttons open dialogs; closing a
  // dialog never hides the panel itself.
  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setBipEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setBipEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const onMq = () => setStandalone(isStandalone());
    mq?.addEventListener?.("change", onMq);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      mq?.removeEventListener?.("change", onMq);
    };
  }, []);

  const canPrompt = !!bipEvent;
  const appInstalled = standalone || installed;

  // Status + reason shown at the top of the install-as-app dialog so the
  // user always knows whether one-click install is supported and why.
  const status = useMemo(() => {
    if (appInstalled)
      return { color: "bg-green-500", label: "Installed", reason: "Open from your home screen or app launcher." };
    if (canPrompt)
      return { color: "bg-green-500", label: "Ready to install", reason: "Your browser supports one-click install." };
    if (platform === "ios" && browser === "safari")
      return { color: "bg-blue-500", label: "Use the Share sheet", reason: "iOS Safari installs via Share → Add to Home Screen." };
    if (browser === "firefox")
      return { color: "bg-zinc-400", label: "Not supported in this browser", reason: "Firefox does not implement one-click web-app install. Use Chrome, Edge, or Brave." };
    if (browser === "chromium")
      return { color: "bg-amber-500", label: "Waiting for browser…", reason: "Your browser supports install but hasn't offered the prompt yet. Interact with the page or revisit later." };
    return { color: "bg-zinc-400", label: "Not supported in this browser", reason: "Open the site in Chrome, Edge, or Brave to install as an app." };
  }, [appInstalled, canPrompt, platform, browser]);

  const install = async () => {
    if (!bipEvent) return;
    await bipEvent.prompt();
    const choice = await bipEvent.userChoice;
    setBipEvent(null);
    if (choice.outcome === "accepted") setPromptAccepted(true);
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
        setZipDownloaded(true);
      })
      .catch((err) => alert(err.message));
  };

  const toggleExtStep = (i: number) => {
    const next = extSteps.map((v, idx) => (idx === i ? !v : v));
    setExtSteps(next);
    try {
      localStorage.setItem(EXT_STEPS_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / privacy mode
    }
  };

  // Platform-specific install steps with real-time `done` flags.
  const appSteps = useMemo(() => {
    if (platform === "ios") {
      return [
        { label: "Open this page in Safari.", done: browser === "safari" },
        { label: "Tap the Share button.", done: appInstalled },
        { label: "Choose 'Add to Home Screen'.", done: appInstalled },
        { label: "Open the new icon from your home screen.", done: standalone },
      ];
    }
    const isChrome = browser === "chromium";
    return [
      {
        label: platform === "android"
          ? "Open this page in Chrome on Android."
          : "Open this page in Chrome, Edge, or Brave.",
        done: isChrome,
      },
      { label: "Click the 'Install' button below.", done: canPrompt && promptAccepted },
      { label: "Confirm your browser's install dialog.", done: installed },
      { label: "Launch the app from your launcher / dock.", done: standalone },
    ];
  }, [platform, browser, canPrompt, promptAccepted, installed, standalone, appInstalled]);

  // Extension steps: step 1 (download) auto-completes; the rest are
  // user-toggled because we can't observe `chrome://extensions` actions.
  const extStepDefs = [
    { label: "Download the .zip below.", done: zipDownloaded || extSteps[0], onToggle: undefined },
    { label: "Unzip the downloaded file.", done: extSteps[1], onToggle: () => toggleExtStep(1) },
    {
      label: "Open chrome://extensions and enable Developer mode (top-right).",
      done: extSteps[2],
      onToggle: () => toggleExtStep(2),
    },
    {
      label: "Click 'Load unpacked' and select the unzipped folder.",
      done: extSteps[3],
      onToggle: () => toggleExtStep(3),
    },
  ];

  return (
    <div
      className="mx-auto mt-6 grid w-full max-w-md grid-cols-1 gap-2 rounded-md border border-border bg-card p-2 sm:max-w-xl sm:grid-cols-2 sm:divide-x sm:divide-border"
      data-testid="install-prompt"
    >
      {/* Install as an app */}
      <Dialog open={appOpen} onOpenChange={setAppOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              {appInstalled ? <Check className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
            </div>
            <span className="min-w-0 truncate text-sm font-medium">
              {appInstalled ? "Installed" : t("install.title")}
            </span>
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("install.title")}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${status.color}`} />
                  <span className="font-medium text-foreground">{status.label}</span>
                </div>
                <p className="flex gap-1.5">
                  {!canPrompt && !appInstalled && (
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                  )}
                  <span>{status.reason}</span>
                </p>
                {platform === "ios" && browser === "safari" && (
                  <p className="text-muted-foreground">
                    {t("install.ios_hint_prefix")}{" "}
                    <Share className="inline h-3 w-3 align-[-2px]" />{" "}
                    {t("install.ios_hint_suffix")}{" "}
                    <span className="font-medium">"{t("install.ios_add")}"</span>.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          {canPrompt && !appInstalled && (
            <Button onClick={install} className="w-full">
              <Download className="h-4 w-4" />
              {t("install.btn")}
            </Button>
          )}
          <StepList steps={appSteps} />
        </DialogContent>
      </Dialog>

      {/* Browser extension */}
      <Dialog open={extOpen} onOpenChange={setExtOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <Puzzle className="h-4 w-4" />
            </div>
            <span className="min-w-0 truncate text-sm font-medium">
              {t("install.ext_title")}
            </span>
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("install.ext_title")}</DialogTitle>
            <DialogDescription className="text-xs">
              {t("install.ext_desc")}
            </DialogDescription>
          </DialogHeader>
          <Button onClick={downloadExtension} className="w-full">
            <Download className="h-4 w-4" />
            {t("install.ext_download")}
          </Button>
          <StepList steps={extStepDefs} />
        </DialogContent>
      </Dialog>
    </div>
  );
});

InstallPrompt.displayName = "InstallPrompt";
