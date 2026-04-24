import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye } from "lucide-react";
import * as Y from "yjs";
import { supabase } from "@/integrations/supabase/client";
import { Preview } from "@/components/note/Preview";
import { UnlockForm } from "@/components/note/UnlockForm";
import { EditorSkeleton } from "@/components/note/EditorSkeleton";
import { deriveKey, decryptBytes, verifyCheck } from "@/lib/crypto";
import { base64ToBytes } from "@/lib/yjs/base64";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

type ShareViewResponse = {
  content: string;
  ydoc_state: string;
  is_encrypted: boolean;
  enc_salt: string | null;
  enc_check: string | null;
  updated_at: string;
};

type ViewState =
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "error"; message: string }
  | { kind: "ready"; doc: Y.Doc }
  | { kind: "needs-key"; salt: string; check: string; ydocState: string };

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

  useEffect(() => {
    document.title = "Syrin Notes — chia sẻ";
    return () => {
      document.title = "Syrin Notes";
    };
  }, []);

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
        setState({ kind: "error", message: "Note đã mã hoá nhưng thiếu salt/check." });
        return;
      }

      // If a key is already in the URL hash (typical share-with-key flow),
      // try to unlock silently. On failure, drop through to the password form.
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash) {
        try {
          const key = await deriveKey(hash, data.enc_salt);
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
          ydocState: data.ydoc_state,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, valid]);

  const onUnlock = async (key: CryptoKey) => {
    if (state.kind !== "needs-key") return;
    try {
      const pt = await decryptBytes(key, base64ToBytes(state.ydocState));
      const doc = new Y.Doc();
      Y.applyUpdate(doc, pt);
      setState({ kind: "ready", doc });
    } catch (e) {
      console.error("share: manual decrypt failed", e);
      setState({ kind: "error", message: "Giải mã lỗi." });
    }
  };

  if (state.kind === "loading") return <EditorSkeleton />;

  if (state.kind === "notfound") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-sm text-muted-foreground">Link không tồn tại hoặc đã bị thu hồi.</p>
        <Link to="/" className="text-sm text-primary hover:underline">← Về trang chủ</Link>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-sm text-destructive">{state.message}</p>
        <Link to="/" className="text-sm text-primary hover:underline">← Về trang chủ</Link>
      </div>
    );
  }

  if (state.kind === "needs-key") {
    // UnlockForm is reused as-is; it takes a `slug` label but shows it only
    // as a caption. Using "(chia sẻ)" instead of the real slug keeps the
    // slug hidden.
    return (
      <UnlockForm slug="(chia sẻ)" salt={state.salt} check={state.check} onUnlock={onUnlock} />
    );
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-border bg-background/95 px-3 text-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label="Về trang chủ">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Eye className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">Chế độ chỉ đọc</span>
      </header>
      <div className="flex-1 overflow-auto bg-muted/30">
        <Preview doc={state.doc} />
      </div>
    </div>
  );
}
