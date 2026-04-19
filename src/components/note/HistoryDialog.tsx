import { useEffect, useState } from "react";
import * as Y from "yjs";
import { Clock, RotateCcw, Eye } from "lucide-react";
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
import { listSnapshots, type Snapshot } from "@/lib/snapshots";
import { toast } from "@/hooks/use-toast";

interface HistoryDialogProps {
  slug: string;
  doc: Y.Doc;
}

function formatTs(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString();
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

export function HistoryDialog({ slug, doc }: HistoryDialogProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Snapshot[]>([]);
  const [viewing, setViewing] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!open) return;
    listSnapshots(slug).then(setItems);
  }, [open, slug]);

  const restore = (snap: Snapshot) => {
    const ok = window.confirm(
      `Khôi phục bản ${formatTs(snap.ts)} (${snap.charCount} ký tự)?\n\nThao tác này sẽ thay thế nội dung hiện tại trên TẤT CẢ thiết bị đang mở note.`
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Lịch sử (Khôi phục)"
          title="Lịch sử & Khôi phục"
        >
          <Clock className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lịch sử cục bộ</DialogTitle>
          <DialogDescription>
            App tự động lưu một bản chụp mỗi 10 phút (tối đa 10 bản, chỉ trên thiết bị này).
            Dùng để khôi phục nếu lỡ tay xoá.
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
          <ScrollArea className="max-h-[60vh]">
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
        )}
      </DialogContent>
    </Dialog>
  );
}
