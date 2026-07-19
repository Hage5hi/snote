import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
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
const SHARE_CANONICAL_URL = "https://note.syrin.online/s";
const SHARE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";

type ShareViewResponse = {
  content: string;
  ydoc_state: string;
  is_encrypted: boolean;
  enc_salt: string | null;
  enc_check: string | null;
  enc_iterations: number | null;
  updated_at: string;
};

type RequestTarget = {
  token: string;
  targetHash: string;
  generation: number;
};

type ViewState =
  | (RequestTarget & { kind: "loading" })
  | (RequestTarget & { kind: "notfound" })
  | (RequestTarget & { kind: "error"; message: string })
  | (RequestTarget & { kind: "ready"; doc: Y.Doc })
  | (RequestTarget & { kind: "needs-key"; salt: string; check: string; iterations: number; ydocState: string });

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
  const location = useLocation();
  const valid = TOKEN_RE.test(token);
  const [currentHash, setCurrentHash] = useState(
    () => window.location.hash,
  );
  const [externalHashRevision, setExternalHashRevision] = useState(0);
  const [state, setState] = useState<ViewState>(() => ({
    kind: "loading",
    token,
    targetHash: currentHash,
    generation: 0,
  }));
  const requestGeneration = useRef(0);
  const currentHashRef = useRef(currentHash);
  const committedTargetRef = useRef({ token, targetHash: currentHash });
  const routerTarget = `${location.key}\u0000${location.pathname}\u0000${location.search}\u0000${location.hash}`;
  const routerTargetRef = useRef(routerTarget);
  const { t } = useI18n();
  const translationRef = useRef(t);

  const observeExternalHash = useCallback((nextHash: string) => {
    if (currentHashRef.current === nextHash) return;
    currentHashRef.current = nextHash;
    setCurrentHash(nextHash);
    setExternalHashRevision((revision) => revision + 1);
  }, []);

  useLayoutEffect(() => {
    translationRef.current = t;
  }, [t]);

  useLayoutEffect(() => {
    const syncHash = () => observeExternalHash(window.location.hash);
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    // Close the commit-to-subscription race: reconcile any navigation that
    // happened after render but before these listeners were attached.
    syncHash();
    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, [observeExternalHash]);

  useLayoutEffect(() => {
    if (routerTargetRef.current === routerTarget) return;
    routerTargetRef.current = routerTarget;
    observeExternalHash(location.hash);
  }, [routerTarget, location.hash, observeExternalHash]);

  useLayoutEffect(() => {
    committedTargetRef.current = { token, targetHash: currentHash };
  }, [token, currentHash]);

  const isCurrentRequest = useCallback((
    generation: number,
    requestToken: string,
    requestHash: string,
  ) => {
    const committedTarget = committedTargetRef.current;
    return requestGeneration.current === generation
      && committedTarget.token === requestToken
      && committedTarget.targetHash === requestHash
      && window.location.hash === requestHash;
  }, []);

  useEffect(() => {
    document.title = `Syrin Notes — ${t("share.title_suffix")}`;
    return () => {
      document.title = "Syrin Notes";
    };
  }, [t]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const requestToken = token;
    const requestHash = currentHashRef.current;
    const requestTarget: RequestTarget = {
      token: requestToken,
      targetHash: requestHash,
      generation,
    };
    let cancelled = false;
    const isCurrent = () =>
      !cancelled && isCurrentRequest(generation, requestToken, requestHash);
    const cancel = () => {
      cancelled = true;
      if (requestGeneration.current === generation) {
        requestGeneration.current += 1;
      }
    };

    if (!valid) {
      setState({ kind: "notfound", ...requestTarget });
      return cancel;
    }
    setState({ kind: "loading", ...requestTarget });
    (async () => {
      const { data, error } = await supabase.functions.invoke<ShareViewResponse>(
        "share-view",
        { body: { token: requestToken } },
      );
      if (!isCurrent()) return;
      if (error || !data) {
        setState({ kind: "notfound", ...requestTarget });
        return;
      }

      if (!data.is_encrypted) {
        setState({
          kind: "ready",
          ...requestTarget,
          doc: hydrateDoc(data.ydoc_state, data.content),
        });
        return;
      }

      if (!data.enc_salt || !data.enc_check) {
        setState({
          kind: "error",
          ...requestTarget,
          message: translationRef.current("share.missing_salt"),
        });
        return;
      }

      // If a key is already in the URL hash (typical share-with-key flow),
      // try to unlock silently. On failure, drop through to the password form.
      const iterations = iterationsFor(data.enc_iterations);
      let hash = "";
      try {
        hash = decodeURIComponent(requestHash.replace(/^#/, ""));
      } catch {
        // Malformed fragments fail closed to the manual unlock form.
      }
      if (hash) {
        try {
          const key = await deriveKey(hash, data.enc_salt, iterations);
          if (!isCurrent()) return;
          const verified = await verifyCheck(key, data.enc_check);
          if (!isCurrent()) return;
          if (verified) {
            const pt = await decryptBytes(key, base64ToBytes(data.ydoc_state));
            if (!isCurrent()) return;
            const doc = new Y.Doc();
            Y.applyUpdate(doc, pt);
            setState({ kind: "ready", ...requestTarget, doc });
            return;
          }
        } catch (e) {
          if (!isCurrent()) return;
          console.warn("share: auto-decrypt failed", e);
        }
      }

      if (isCurrent()) {
        setState({
          kind: "needs-key",
          ...requestTarget,
          salt: data.enc_salt,
          check: data.enc_check,
          iterations,
          ydocState: data.ydoc_state,
        });
      }
    })();
    return cancel;
  }, [token, valid, externalHashRevision, isCurrentRequest]);

  const onUnlock = async (key: CryptoKey) => {
    if (state.kind !== "needs-key") return;
    const lockedState = state;
    const generation = lockedState.generation;
    const requestToken = lockedState.token;
    const requestHash = window.location.hash;
    const isCurrentManualRequest = () => {
      const committedTarget = committedTargetRef.current;
      return requestGeneration.current === generation
        && committedTarget.token === requestToken
        && committedTarget.targetHash === lockedState.targetHash
        && window.location.hash === requestHash;
    };
    if (!isCurrentManualRequest()) return;
    try {
      const pt = await decryptBytes(key, base64ToBytes(lockedState.ydocState));
      if (!isCurrentManualRequest()) return;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, pt);
      currentHashRef.current = requestHash;
      setCurrentHash(requestHash);
      setState({
        kind: "ready",
        token: requestToken,
        targetHash: requestHash,
        generation,
        doc,
      });
    } catch (e) {
      if (!isCurrentManualRequest()) return;
      console.error("share: manual decrypt failed", e);
      currentHashRef.current = requestHash;
      setCurrentHash(requestHash);
      setState({
        kind: "error",
        token: requestToken,
        targetHash: requestHash,
        generation,
        message: translationRef.current("share.decrypt_failed"),
      });
    }
  };

  const head = (
    <Helmet>
      <title>Shared note — Syrin Notes</title>
      {/* eslint-disable no-restricted-syntax -- crawler-facing SEO copy (page is noindex) */}
      <meta name="description" content="View a shared markdown note in read-only mode on Syrin Notes. Private link, revocable anytime." />
      <link rel="canonical" href={SHARE_CANONICAL_URL} />
      <meta name="robots" content={SHARE_ROBOTS} />
      <meta name="googlebot" content={SHARE_ROBOTS} />
      <meta property="og:title" content="Shared note — Syrin Notes" />
      <meta property="og:description" content="A markdown note shared in read-only mode. Private link, revocable." />
      <meta property="og:url" content={SHARE_CANONICAL_URL} />
      <meta name="twitter:title" content="Shared note — Syrin Notes" />
      <meta name="twitter:description" content="A markdown note shared in read-only mode." />
      {/* eslint-enable no-restricted-syntax */}
    </Helmet>
  );

  if (
    state.token !== token || state.targetHash !== currentHash
    || state.kind === "loading"
  ) {
    return <>{head}<EditorSkeleton /></>;
  }

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

  return <ShareReady head={head} doc={state.doc} t={t} />;
}

function ShareReady({ head, doc, t }: { head: React.ReactNode; doc: Y.Doc; t: ReturnType<typeof useI18n>["t"] }) {
  const { scene } = useSceneTheme();
  const hasScene = scene !== "none";
  return (
    <>
      {head}
      <AppShell className="flex min-h-svh flex-col">
        <header
          className={
            "sticky top-0 z-30 flex h-11 items-center gap-2 border-b px-3 text-sm " +
            (hasScene
              ? "motion-safe:backdrop-blur-md"
              : "border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80")
          }
          style={
            hasScene
              ? { background: "var(--home-chrome-bg)", borderColor: "var(--home-chrome-border)" }
              : undefined
          }
        >
          <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label={t("share.back_home_aria")}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">{t("share.read_only")}</span>
        </header>
        <div className="flex-1 overflow-auto bg-muted/30">
          <Preview doc={doc} />
        </div>
      </AppShell>
    </>
  );
}
