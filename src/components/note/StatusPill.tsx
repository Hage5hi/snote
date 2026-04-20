import { useEffect, useState } from "react";
import { Check, CloudOff, Loader2, Pencil, WifiOff } from "lucide-react";
import type { SaveStatus } from "@/lib/yjs/provider";

interface StatusPillProps {
  status: SaveStatus;
  onClick?: () => void;
}

function relativeTime(ms: number): string {
  if (ms < 5_000) return "vừa xong";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h trước`;
  return `${Math.floor(h / 24)}d trước`;
}

export function StatusPill({ status, onClick }: StatusPillProps) {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    if (status === "saved") setSavedAt(Date.now());
  }, [status]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Reference tick to force re-render every 5s (otherwise relative time freezes).
  void tick;

  let icon: JSX.Element;
  let label: string;
  let cls: string;

  if (!online) {
    icon = <WifiOff className="h-3 w-3" />;
    label = "Offline";
    cls = "text-warning";
  } else if (status === "idle") {
    icon = <Loader2 className="h-3 w-3 animate-spin" />;
    label = "Connecting…";
    cls = "text-muted-foreground";
  } else if (status === "editing") {
    icon = <Pencil className="h-3 w-3" />;
    label = "Editing…";
    cls = "text-muted-foreground";
  } else if (status === "saving") {
    icon = <Loader2 className="h-3 w-3 animate-spin" />;
    label = "Saving…";
    cls = "text-muted-foreground";
  } else if (status === "offline") {
    icon = <CloudOff className="h-3 w-3" />;
    label = "Offline";
    cls = "text-warning";
  } else {
    icon = <Check className="h-3 w-3" />;
    label = savedAt ? `Saved ${relativeTime(Date.now() - savedAt)}` : "Saved";
    cls = "text-success";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent ${cls}`}
      title="Click để mở History"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
