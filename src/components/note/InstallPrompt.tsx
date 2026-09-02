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
  labels,
}: {
  steps: { label: string; done: boolean; onToggle?: () => void }[];
  labels: { completed: string; mark: string };
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
            aria-label={s.done ? labels.completed : labels.mark}
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
      return { color: "bg-green-500", label: t("install.status_installed_label"), reason: t("install.status_installed_reason") };
    if (canPrompt)
      return { color: "bg-green-500", label: t("install.status_ready_label"), reason: t("install.status_ready_reason") };
    if (platform === "ios" && browser === "safari")
      return { color: "bg-blue-500", label: t("install.status_ios_label"), reason: t("install.status_ios_reason") };
    if (browser === "firefox")
      return { color: "bg-zinc-400", label: t("install.status_firefox_label"), reason: t("install.status_firefox_reason") };
    if (browser === "chromium")
      return { color: "bg-amber-500", label: t("install.status_waiting_label"), reason: t("install.status_waiting_reason") };
    return { color: "bg-zinc-400", label: t("install.status_unsupported_label"), reason: t("install.status_unsupported_reason") };
  }, [appInstalled, canPrompt, platform, browser, t]);


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
        { label: t("install.app_step_ios_1"), done: browser === "safari" },
        { label: t("install.app_step_ios_2"), done: appInstalled },
        { label: t("install.app_step_ios_3"), done: appInstalled },
        { label: t("install.app_step_ios_4"), done: standalone },
      ];
    }
    const isChrome = browser === "chromium";
    return [
      {
        label: platform === "android"
          ? t("install.app_step_android_1")
          : t("install.app_step_desktop_1"),
        done: isChrome,
      },
      { label: t("install.app_step_chromium_2"), done: canPrompt && promptAccepted },
      { label: t("install.app_step_chromium_3"), done: installed },
      { label: t("install.app_step_chromium_4"), done: standalone },
    ];
  }, [platform, browser, canPrompt, promptAccepted, installed, standalone, appInstalled, t]);

  // Extension steps: step 1 (download) auto-completes; the rest are
  // user-toggled because we can't observe `chrome://extensions` actions.
  const extStepDefs = [
    { label: t("install.ext_step_download"), done: zipDownloaded || extSteps[0], onToggle: undefined },
    { label: t("install.ext_step_unzip"), done: extSteps[1], onToggle: () => toggleExtStep(1) },
    {
      label: t("install.ext_step_devmode"),
      done: extSteps[2],
      onToggle: () => toggleExtStep(2),
    },
    {
      label: t("install.ext_step_loadunpacked"),
      done: extSteps[3],
      onToggle: () => toggleExtStep(3),
    },
  ];

  const stepLabels = { completed: t("install.step_completed"), mark: t("install.step_mark") };


  return (
    <div
      role="region"
      aria-label={t("install.panel_label")}
      className="mx-auto mt-6 grid w-full max-w-md grid-cols-1 gap-2 rounded-md border border-border bg-card p-2 sm:max-w-xl sm:grid-cols-2 sm:divide-x sm:divide-border"
      data-testid="install-prompt"
    >
      {/* Install as an app */}
      <Dialog open={appOpen} onOpenChange={setAppOpen}>
        {/* Open on mouse down, not click: Home's lazy template picker can
            commit mid-click and swallow the mouseup (firefox BIP e2e). */}
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent"
          aria-haspopup="dialog"
          aria-expanded={appOpen}
          onMouseDown={(e) => {
            if (e.button === 0) setAppOpen(true);
          }}
          onClick={() => setAppOpen(true)}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            {appInstalled ? <Check className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
          </div>
          <span className="min-w-0 truncate text-sm font-medium">
            {appInstalled ? t("install.status_installed_label") : t("install.title")}
          </span>
        </button>
        <DialogContent
          hideClose
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="max-h-[85vh] overflow-y-auto sm:max-w-md"
        >
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
          <StepList steps={appSteps} labels={stepLabels} />
        </DialogContent>
      </Dialog>

      {/* Browser extension */}
      <Dialog open={extOpen} onOpenChange={setExtOpen}>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent"
          aria-haspopup="dialog"
          aria-expanded={extOpen}
          onMouseDown={(e) => {
            if (e.button === 0) setExtOpen(true);
          }}
          onClick={() => setExtOpen(true)}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <Puzzle className="h-4 w-4" />
          </div>
          <span className="min-w-0 truncate text-sm font-medium">
            {t("install.ext_title")}
          </span>
        </button>
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
          <StepList steps={extStepDefs} labels={stepLabels} />
        </DialogContent>
      </Dialog>
    </div>
  );
});


InstallPrompt.displayName = "InstallPrompt";
