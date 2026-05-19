import { useEffect, useState } from "react";
import * as Y from "yjs";
import { Clock, RotateCcw, Eye, GitCompare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listSnapshots, type Snapshot } from "@/lib/snapshots";
import { toast } from "@/hooks/use-toast";
import { SnapshotDiff } from "./SnapshotDiff";

interface HistoryDialogProps {
  slug: string;
  doc: Y.Doc;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: boolean;
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleString();
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  return `${d} ngày trước`;
}

export function HistoryDialog({
  slug,
  doc,
  open: openProp,
  onOpenChange,
  trigger = true,
}: HistoryDialogProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (v: boolean) => {
    setOpenInternal(v);
    onOpenChange?.(v);
  };

  const [items, setItems] = useState<Snapshot[]>([]);
  const [viewing, setViewing] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<"list" | "diff">("list");
  const [diffA, setDiffA] = useState<string>("");
  const [diffB, setDiffB] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    listSnapshots(slug).then((list) => {
      setItems(list);
      // Default: compare latest snapshot vs current document.
      if (list.length > 0) {
        setDiffA(String(list[0].id ?? ""));
        setDiffB("__current__");
      }
    });
  }, [open, slug]);

  const restore = (snap: Snapshot) => {
    const ok = window.confirm(
      `Khôi phục bản ${formatTs(snap.ts)} (${snap.charCount} ký tự)?\n\nThao tác này sẽ thay thế nội dung hiện tại trên TẤT CẢ thiết bị đang mở note.`,
    );
    if (!ok) return;
    const ytext = doc.getText("content");
    doc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, snap.content);
    });
    toast({ title: "Đã khôi phục", description: `${snap.charCount} ký tự` });
    setOpen(false);
    setViewing(null);
  };

  const getContentFor = (id: string): { text: string; label: string } => {
    if (id === "__current__") {
      return { text: doc.getText("content").toString(), label: "hiện tại" };
    }
    const snap = items.find((s) => String(s.id) === id);
    if (!snap) return { text: "", label: "?" };
    return { text: snap.content, label: timeAgo(snap.ts) };
  };

  const a = getContentFor(diffA);
  const b = getContentFor(diffB);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Lịch sử (Khôi phục)"
              >
                <Clock className="h-4 w-4" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Lịch sử & Khôi phục</TooltipContent>
        </Tooltip>
      )}
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Lịch sử cục bộ</DialogTitle>
          <DialogDescription>
            App tự động lưu một bản chụp mỗi 10 phút (tối đa 10 bản, chỉ trên thiết bị này).
            Dùng để khôi phục nếu lỡ tay xoá hoặc so sánh diff.
          </DialogDescription>
        </DialogHeader>

        {viewing ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatTs(viewing.ts)} • {viewing.charCount} ký tự
              </span>
              <Button variant="ghost" size="sm" onClick={() => setViewing(null)}>
                ← Quay lại
              </Button>
            </div>
            <ScrollArea className="h-[50vh] rounded-md border border-border bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {viewing.content}
              </pre>
            </ScrollArea>
            <div className="flex justify-end">
              <Button onClick={() => restore(viewing)}>
                <RotateCcw className="h-4 w-4" />
                Khôi phục bản này
              </Button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Chưa có bản chụp nào. Bản đầu tiên sẽ được tạo sau ~10 phút.
          </p>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "diff")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="list">
                <Clock className="h-3.5 w-3.5" /> Snapshots
              </TabsTrigger>
              <TabsTrigger value="diff">
                <GitCompare className="h-3.5 w-3.5" /> Diff
              </TabsTrigger>
            </TabsList>

            <TabsContent value="list">
              <ScrollArea className="max-h-[55vh]">
                <ul className="divide-y divide-border">
                  {items.map((snap) => (
                    <li key={snap.id} className="flex items-start gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{timeAgo(snap.ts)}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatTs(snap.ts)} • {snap.charCount} ký tự
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {snap.preview || <em>(trống)</em>}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setViewing(snap)}>
                          <Eye className="h-3.5 w-3.5" />
                          Xem
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => restore(snap)}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          Khôi phục
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="diff" className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-muted-foreground">Bản cũ</span>
                  <select
                    value={diffA}
                    onChange={(e) => setDiffA(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    {items.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {timeAgo(s.ts)} ({s.charCount} kt)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground">Bản mới</span>
                  <select
                    value={diffB}
                    onChange={(e) => setDiffB(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="__current__">Phiên bản hiện tại (live)</option>
                    {items.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {timeAgo(s.ts)} ({s.charCount} kt)
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <SnapshotDiff
                oldText={a.text}
                newText={b.text}
                oldLabel={a.label}
                newLabel={b.label}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
