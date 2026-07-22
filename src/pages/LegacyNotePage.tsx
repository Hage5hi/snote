import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CopyPlus, Eye, Loader2 } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { Link, Navigate, useNavigate } from "react-router-dom";
import * as Y from "yjs";
import { AppShell } from "@/components/app/AppShell";
import { Preview } from "@/components/note/Preview";
import { UnlockForm } from "@/components/note/UnlockForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCapabilityApi } from "@/lib/capability/client";
import { deriveKey, decryptBytes, encryptBytes, iterationsFor, verifyCheck } from "@/lib/crypto";
import {
  createLegacyNoteApi,
  duplicateLegacyNote,
  type LegacyNote,
} from "@/lib/legacy/cutover";
import { base64ToBytes } from "@/lib/yjs/base64";
import type { Encryption } from "@/lib/yjs/provider";
import { useI18n } from "@/i18n";

const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PRIVATE_PAGE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";

type ReadyState = {
  kind: "ready";
  note: LegacyNote;
  doc: Y.Doc;
  encryption: Encryption | null;
  encryptionSecret: string;
};

type State =
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "error"; message: string }
  | { kind: "needs-key"; note: LegacyNote }
  | ReadyState;

function defaultDuplicateSlug(slug: string) {
  const suffix = "-secure";
  return `${slug.slice(0, 64 - suffix.length)}${suffix}`;
}

function hydratePlaintext(note: LegacyNote) {
  const doc = new Y.Doc();
  if (note.ydocState) {
    try {
      Y.applyUpdate(doc, base64ToBytes(note.ydocState));
      return doc;
    } catch {
      // Old rows may contain a stale snapshot; the plain content is the safe
      // read-only fallback and is copied only after explicit user action.
    }
  }
  if (note.content) doc.getText("content").insert(0, note.content);
  return doc;
}

async function unlockLegacy(note: LegacyNote, key: CryptoKey, secret: string): Promise<ReadyState> {
  const plaintext = await decryptBytes(key, base64ToBytes(note.ydocState));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, plaintext);
  return {
    kind: "ready",
    note,
    doc,
    encryption: {
      encrypt: (bytes) => encryptBytes(key, bytes),
      decrypt: (bytes) => decryptBytes(key, bytes),
    },
    encryptionSecret: secret,
  };
}

export default function LegacyNotePage({ slug, embed = false }: { slug: string; embed?: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [targetSlug, setTargetSlug] = useState(() => defaultDuplicateSlug(slug));
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const valid = SLUG_RE.test(slug);
  const legacyApi = useMemo(() => createLegacyNoteApi(), []);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    let ownedDoc: Y.Doc | null = null;
    setState({ kind: "loading" });
    setTargetSlug(defaultDuplicateSlug(slug));
    setDuplicateError(null);
    void legacyApi.open(slug, controller.signal).then(async (note) => {
      if (controller.signal.aborted) return;
      if (!note) {
        setState({ kind: "notfound" });
        return;
      }
      if (!note.isEncrypted) {
        ownedDoc = hydratePlaintext(note);
        setState({ kind: "ready", note, doc: ownedDoc, encryption: null, encryptionSecret: "" });
        return;
      }
      const rawHash = window.location.hash.slice(1);
      let secret = "";
      try { secret = decodeURIComponent(rawHash); } catch { /* manual unlock */ }
      if (!secret || !note.salt || !note.check) {
        setState({ kind: "needs-key", note });
        return;
      }
      try {
        const key = await deriveKey(secret, note.salt, iterationsFor(note.iterations));
        if (controller.signal.aborted) return;
        if (!(await verifyCheck(key, note.check))) {
          setState({ kind: "needs-key", note });
          return;
        }
        const ready = await unlockLegacy(note, key, secret);
        if (controller.signal.aborted) {
          ready.doc.destroy();
          return;
        }
        ownedDoc = ready.doc;
        setState(ready);
      } catch {
        if (!controller.signal.aborted) setState({ kind: "needs-key", note });
      }
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setState({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
      }
    });
    return () => {
      controller.abort();
      ownedDoc?.destroy();
    };
  }, [legacyApi, slug, valid]);

  if (!valid) return <Navigate to="/" replace />;

  const head = (
    <Helmet>
      <title>{t("legacy.title")}</title>
      <link rel="canonical" href="https://note.syrin.online/" />
      <meta name="robots" content={PRIVATE_PAGE_ROBOTS} />
      <meta name="googlebot" content={PRIVATE_PAGE_ROBOTS} />
    </Helmet>
  );

  if (state.kind === "loading") {
    return <>{head}<div className="flex h-full min-h-svh items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div></>;
  }
  if (state.kind === "notfound" || state.kind === "error") {
    return (
      <>{head}<div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground">
          {state.kind === "notfound" ? t("legacy.not_found") : t("legacy.unavailable")}
        </p>
        <Link to="/" className="text-sm text-primary hover:underline">{t("share.back_home")}</Link>
      </div></>
    );
  }
  if (state.kind === "needs-key") {
    return (
      <>{head}<UnlockForm
        slug={slug}
        salt={state.note.salt!}
        check={state.note.check!}
        iterations={iterationsFor(state.note.iterations)}
        onUnlock={(key) => {
          const secret = (() => {
            try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
          })();
          void unlockLegacy(state.note, key, secret).then(setState).catch(() => {
            setState({ kind: "error", message: "decrypt failed" });
          });
        }}
      /></>
    );
  }

  const onDuplicate = async (event: FormEvent) => {
    event.preventDefault();
    setDuplicateError(null);
    setDuplicating(true);
    try {
      const url = new URL(await duplicateLegacyNote({
        api: createCapabilityApi(),
        source: state.note,
        doc: state.doc,
        targetSlug: targetSlug.trim(),
        encryption: state.encryption,
        encryptionSecret: state.encryptionSecret,
      }));
      navigate(`${url.pathname}${url.hash}`, { replace: true });
    } catch (cause) {
      setDuplicateError(cause instanceof Error ? cause.message : String(cause));
      setDuplicating(false);
    }
  };

  const content = (
    <>
      {head}
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        {!embed && <Link to="/" aria-label={t("share.back_home_aria")}><ArrowLeft className="h-4 w-4" /></Link>}
        <Eye className="h-4 w-4 text-muted-foreground" />
        <span className="mr-auto text-xs font-medium text-muted-foreground">{t("legacy.read_only")}</span>
        <form className="flex min-w-0 items-center gap-2" onSubmit={onDuplicate}>
          <label htmlFor={`duplicate-${slug}`} className="sr-only">{t("legacy.new_slug")}</label>
          <Input
            id={`duplicate-${slug}`}
            value={targetSlug}
            onChange={(event) => setTargetSlug(event.target.value)}
            pattern="[A-Za-z0-9_-]{1,64}"
            maxLength={64}
            className="h-8 w-36 font-mono text-xs sm:w-48"
            aria-invalid={!!duplicateError}
          />
          <Button type="submit" size="sm" disabled={duplicating || !SLUG_RE.test(targetSlug.trim())}>
            {duplicating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CopyPlus className="h-4 w-4" />}
            <span className="hidden sm:inline">{t("legacy.duplicate_securely")}</span>
          </Button>
        </form>
        {duplicateError && <p className="basis-full text-right text-xs text-destructive" role="alert">{duplicateError}</p>}
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-muted/30"><Preview doc={state.doc} /></main>
    </>
  );

  return embed
    ? <div className="flex h-full min-h-0 flex-col">{content}</div>
    : <AppShell className="flex h-svh flex-col">{content}</AppShell>;
}
