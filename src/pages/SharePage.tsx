import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, Eye } from "lucide-react";
import * as Y from "yjs";
import { supabase } from "@/integrations/supabase/client";
import { Preview } from "@/components/note/Preview";
import { UnlockForm } from "@/components/note/UnlockForm";
import { EditorSkeleton } from "@/components/note/EditorSkeleton";
import { deriveKey, decryptBytes, verifyCheck, iterationsFor } from "@/lib/crypto";
import { base64ToBytes } from "@/lib/yjs/base64";
import { useI18n } from "@/i18n";
import { AppShell } from "@/components/app/AppShell";
import { useSceneTheme } from "@/hooks/use-scene-theme";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

type ShareViewResponse = {
  content: string;
  ydoc_state: string;
  is_encrypted: boolean;
  enc_salt: string | null;
  enc_check: string | null;
  enc_iterations: number | null;
  updated_at: string;
};

type ViewState =
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "error"; message: string }
  | { kind: "ready"; doc: Y.Doc }
  | { kind: "needs-key"; salt: string; check: string; iterations: number; ydocState: string };

function hydrateDoc(ydocB64: string, fallbackText: string): Y.Doc {
  const doc = new Y.Doc();
  if (ydocB64) {
    try {
      Y.applyUpdate(doc, base64ToBytes(ydocB64));
      return doc;
    } catch (e) {
      console.warn("share: applyUpdate failed", e);
    }
  }
  // Notes sometimes have empty ydoc_state but non-empty content (legacy rows
  // or freshly-typed plaintext that hasn't been snapshotted yet). Seed the
  // yjs doc from the plain content column so the preview still renders.
  if (fallbackText) doc.getText("content").insert(0, fallbackText);
  return doc;
}

export default function SharePage() {
  const { token = "" } = useParams();
  const valid = TOKEN_RE.test(token);
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const { t } = useI18n();

  useEffect(() => {
    document.title = `Syrin Notes — ${t("share.title_suffix")}`;
    return () => {
      document.title = "Syrin Notes";
    };
  }, [t]);

  useEffect(() => {
    if (!valid) {
      setState({ kind: "notfound" });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke<ShareViewResponse>(
        "share-view",
        { body: { token } },
      );
      if (cancelled) return;
      if (error || !data) {
        setState({ kind: "notfound" });
        return;
      }

      if (!data.is_encrypted) {
        setState({ kind: "ready", doc: hydrateDoc(data.ydoc_state, data.content) });
        return;
      }

      if (!data.enc_salt || !data.enc_check) {
        setState({ kind: "error", message: t("share.missing_salt") });
        return;
      }

      // If a key is already in the URL hash (typical share-with-key flow),
      // try to unlock silently. On failure, drop through to the password form.
      const iterations = iterationsFor(data.enc_iterations);
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash) {
        try {
          const key = await deriveKey(hash, data.enc_salt, iterations);
          if (await verifyCheck(key, data.enc_check)) {
            const pt = await decryptBytes(key, base64ToBytes(data.ydoc_state));
            const doc = new Y.Doc();
            Y.applyUpdate(doc, pt);
            if (!cancelled) setState({ kind: "ready", doc });
            return;
          }
        } catch (e) {
          console.warn("share: auto-decrypt failed", e);
        }
      }

      if (!cancelled) {
        setState({
          kind: "needs-key",
          salt: data.enc_salt,
          check: data.enc_check,
          iterations,
          ydocState: data.ydoc_state,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, valid, t]);

  const onUnlock = async (key: CryptoKey) => {
    if (state.kind !== "needs-key") return;
    try {
      const pt = await decryptBytes(key, base64ToBytes(state.ydocState));
      const doc = new Y.Doc();
      Y.applyUpdate(doc, pt);
      setState({ kind: "ready", doc });
    } catch (e) {
      console.error("share: manual decrypt failed", e);
      setState({ kind: "error", message: t("share.decrypt_failed") });
    }
  };

  const head = (
    <Helmet>
      <title>Shared note — Syrin Notes</title>
      {/* eslint-disable no-restricted-syntax -- crawler-facing SEO copy (page is noindex) */}
      <meta name="description" content="View a shared markdown note in read-only mode on Syrin Notes. Private link, revocable anytime." />
      <link rel="canonical" href={`https://snote.lovable.app/s/${token}`} />
      <meta name="robots" content="noindex, nofollow" />
      <meta property="og:title" content="Shared note — Syrin Notes" />
      <meta property="og:description" content="A markdown note shared in read-only mode. Private link, revocable." />
      <meta property="og:url" content={`https://snote.lovable.app/s/${token}`} />
      <meta name="twitter:title" content="Shared note — Syrin Notes" />
      <meta name="twitter:description" content="A markdown note shared in read-only mode." />
      {/* eslint-enable no-restricted-syntax */}
    </Helmet>
  );

  if (state.kind === "loading") return <>{head}<EditorSkeleton /></>;

  if (state.kind === "notfound") {
    return (
      <>
        {head}
        <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-4 text-center">
          <p className="text-sm text-muted-foreground">{t("share.notfound")}</p>
          <Link to="/" className="text-sm text-primary hover:underline">{t("share.back_home")}</Link>
        </div>
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        {head}
        <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-4 text-center">
          <p className="text-sm text-destructive">{state.message}</p>
          <Link to="/" className="text-sm text-primary hover:underline">{t("share.back_home")}</Link>
        </div>
      </>
    );
  }

  if (state.kind === "needs-key") {
    return (
      <>
        {head}
        <UnlockForm
          slug={t("share.slug_label")}
          salt={state.salt}
          check={state.check}
          iterations={state.iterations}
          onUnlock={onUnlock}
        />
      </>
    );
  }

  return (
    <>
      {head}
      <div className="flex min-h-svh flex-col bg-background">
        <header className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-border bg-background/95 px-3 text-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label={t("share.back_home_aria")}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">{t("share.read_only")}</span>
        </header>
        <div className="flex-1 overflow-auto bg-muted/30">
          <Preview doc={state.doc} />
        </div>
      </div>
    </>
  );
}
