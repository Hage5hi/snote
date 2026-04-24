import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deriveKey, verifyCheck } from "@/lib/crypto";

interface UnlockFormProps {
  slug: string;
  salt: string;
  check: string;
  /** PBKDF2 iteration count from the note row (legacy rows: 100k). */
  iterations: number;
  onUnlock: (key: CryptoKey) => void;
}

export function UnlockForm({ slug, salt, check, iterations, onUnlock }: UnlockFormProps) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const key = await deriveKey(pass, salt, iterations);
      const ok = await verifyCheck(key, check);
      if (!ok) {
        setError("Khoá không đúng. Thử lại.");
        setBusy(false);
        return;
      }
      // Reflect in URL hash (so refresh keeps unlocked) without triggering a navigation.
      try {
        history.replaceState(null, "", `${window.location.pathname}#${encodeURIComponent(pass)}`);
      } catch {
        // ignore
      }
      onUnlock(key);
    } catch (err) {
      console.error(err);
      setError("Giải mã lỗi.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-md border border-border p-6">
        <div className="flex items-center gap-2">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <KeyRound className="h-4 w-4" />
          <h1 className="font-mono text-sm">/{slug}</h1>
        </div>
        <div>
          <p className="text-sm font-semibold">Note này được mã hoá</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nhập khoá để giải mã. Server không lưu khoá — nếu mất khoá, không thể khôi phục.
          </p>
        </div>
        <Input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="Khoá"
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !pass.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mở khoá"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Mẹo: thêm <code>#&lt;khoá&gt;</code> vào cuối URL để bỏ qua bước này lần sau.
        </p>
      </form>
    </div>
  );
}
