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
    ],
  },
  {
    title: "Editor",
    items: [
      { keys: [Mod, "F"], label: "Tìm trong note" },
      { keys: [Mod, "Shift", "V"], label: "Toggle Markdown preview" },
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Phím tắt</DialogTitle>
          <DialogDescription>
            Nhấn <Kbd>?</Kbd> bất kỳ lúc nào để mở lại bảng này.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
