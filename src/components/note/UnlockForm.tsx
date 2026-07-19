import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deriveKey, verifyCheck } from "@/lib/crypto";
import { useI18n } from "@/i18n/index";

interface UnlockFormProps {
  slug: string;
  salt: string;
  check: string;
  iterations: number;
  onUnlock: (key: CryptoKey) => void;
}

export function UnlockForm({ slug, salt, check, iterations, onUnlock }: UnlockFormProps) {
  const { t } = useI18n();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const targetRef = useRef({ slug, salt, check, iterations });
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  if (
    targetRef.current.slug !== slug
    || targetRef.current.salt !== salt
    || targetRef.current.check !== check
    || targetRef.current.iterations !== iterations
  ) {
    targetRef.current = { slug, salt, check, iterations };
    requestGenerationRef.current += 1;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setPass("");
    setBusy(false);
    setError(null);
  }, [slug, salt, check, iterations]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass.trim()) return;
    const requestGeneration = ++requestGenerationRef.current;
    const isCurrentRequest = () => mountedRef.current
      && requestGenerationRef.current === requestGeneration;
    setBusy(true);
    setError(null);
    try {
      const key = await deriveKey(pass, salt, iterations);
      if (!isCurrentRequest()) return;
      const ok = await verifyCheck(key, check);
      if (!isCurrentRequest()) return;
      if (!ok) {
        setError(t("unlock.wrong_key"));
        setBusy(false);
        return;
      }
      if (!isCurrentRequest()) return;
      try {
        history.replaceState(null, "", `${window.location.pathname}#${encodeURIComponent(pass)}`);
      } catch {
        // ignore
      }
      if (!isCurrentRequest()) return;
      onUnlockRef.current(key);
    } catch (err) {
      if (!isCurrentRequest()) return;
      console.error(err);
      setError(t("unlock.decrypt_error"));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-md border border-border p-6"
      >
        <div className="flex items-center gap-2">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <KeyRound className="h-4 w-4" />
          <h1 className="font-mono text-sm">/{slug}</h1>
        </div>
        <div>
          <p className="text-sm font-semibold">{t("unlock.heading")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("unlock.desc")}</p>
        </div>
        <Input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={t("unlock.placeholder")}
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !pass.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("unlock.submit")}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          {t("unlock.hint_prefix")} <code>#&lt;key&gt;</code> {t("unlock.hint_suffix")}
        </p>
      </form>
    </div>
  );
}
