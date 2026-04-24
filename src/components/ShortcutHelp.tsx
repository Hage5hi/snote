import { Lightbulb } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isMac =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const Mod = isMac ? "⌘" : "Ctrl";

const SECTIONS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: "Điều hướng",
    items: [
      { keys: [Mod, "K"], label: "Mở Command Palette" },
      { keys: ["?"], label: "Mở bảng phím tắt này" },
      { keys: [Mod, "\\"], label: "Toggle Outline sidebar" },
      { keys: ["F11"], label: "Toggle Zen mode" },
      { keys: ["F9"], label: "Toggle Typewriter mode (line giữ ở giữa màn hình)" },
    ],
  },
  {
    title: "Editor",
    items: [
      { keys: [Mod, "F"], label: "Tìm trong note" },
      { keys: [Mod, "Shift", "V"], label: "Toggle Markdown preview" },
      { keys: [Mod, "Shift", "C"], label: "Copy toàn bộ note" },
      { keys: [Mod, "Shift", "P"], label: "Toggle Lật trang" },
      { keys: ["/"], label: "Mở slash commands (đầu dòng)" },
      { keys: ["#"], label: "Tag autocomplete" },
    ],
  },
  {
    title: "Soạn thảo",
    items: [
      { keys: [Mod, "Z"], label: "Hoàn tác" },
      { keys: [Mod, "Shift", "Z"], label: "Làm lại" },
    ],
  },
];

const TIPS: { title: string; body: string }[] = [
  {
    title: "Mở note nhanh",
    body: "Gõ slug bất kỳ vào URL (ví dụ /todo) — note tự tạo nếu chưa tồn tại.",
  },
  {
    title: "Pin note quan trọng",
    body: "Bấm Star trên Topbar (hoặc trong Cmd+K) để pin note lên đầu palette.",
  },
  {
    title: "Tag để gom note",
    body: "Gõ #tag bất kỳ trong nội dung — chip tag hiện trên Topbar, click để xem note cùng tag.",
  },
  {
    title: "Split view",
    body: "Mở /a+b để xem 2 note cạnh nhau, lý tưởng để so sánh hoặc copy giữa 2 note.",
  },
  {
    title: "Chia sẻ qua QR",
    body: "Bấm Share trên Topbar → quét QR từ điện thoại để mở cùng note.",
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

export function ShortcutHelp({ open, onOpenChange }: ShortcutHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Phím tắt & Mẹo</DialogTitle>
          <DialogDescription>
            Nhấn <Kbd>?</Kbd> bất kỳ lúc nào để mở lại bảng này.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </h3>
              <ul className="space-y-1.5">
                {section.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-foreground">{item.label}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Lightbulb className="h-3 w-3" />
              Mẹo dùng
            </h3>
            <ul className="space-y-2.5">
              {TIPS.map((tip) => (
                <li key={tip.title} className="text-sm">
                  <div className="font-medium text-foreground">{tip.title}</div>
                  <div className="text-xs text-muted-foreground">{tip.body}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
