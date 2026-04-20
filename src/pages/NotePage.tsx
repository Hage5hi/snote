import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { Editor, type EditorHandle } from "@/components/note/Editor";
import { Preview } from "@/components/note/Preview";
import { Topbar } from "@/components/note/Topbar";
import { UnlockForm } from "@/components/note/UnlockForm";
import { PageIndicator } from "@/components/note/PageIndicator";
import { WordCountPill } from "@/components/note/WordCountPill";
import { useWordGoal, consumeGoalReached } from "@/hooks/use-word-goal";
import { toast } from "@/hooks/use-toast";
import { OutlineSidebar } from "@/components/note/OutlineSidebar";
import { SupabaseYjsProvider, type SaveStatus, type Encryption } from "@/lib/yjs/provider";
import { getIdentity } from "@/lib/yjs/identity";
import { touchRecent } from "@/lib/recent-notes";
import type { PresenceUser } from "@/components/note/PresenceDots";
import { maybeSaveSnapshot, recordOnSuddenDelete } from "@/lib/snapshots";
import { useZenMode } from "@/hooks/use-zen-mode";
import { useEink } from "@/hooks/use-eink";
import { usePagination } from "@/hooks/use-pagination";
import { supabase } from "@/integrations/supabase/client";
import { deriveKey, encryptBytes, decryptBytes, verifyCheck } from "@/lib/crypto";

type ProviderBundle = { provider: SupabaseYjsProvider; doc: Y.Doc };

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const SUDDEN_DELETE_THRESHOLD = 500;
const SUDDEN_DELETE_WINDOW_MS = 2000;

interface NotePageProps {
  /** When provided (e.g. from SplitView), use this slug instead of the route param. */
  embedSlug?: string;
}

type EncMeta = {
  isEncrypted: boolean;
  salt: string | null;
  check: string | null;
};

export default function NotePage({ embedSlug }: NotePageProps) {
  const params = useParams();
  const slug = embedSlug ?? params.slug ?? "";
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  const [showPreview, setShowPreview] = useState(!isMobile && !embedSlug);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [counts, setCounts] = useState({ chars: 0, words: 0 });
  const editorRef = useRef<EditorHandle>(null);
  const { zen, toggle: toggleZen } = useZenMode();
  const { enabled: paginated, toggle: togglePagination, flip, page, totalPages } = usePagination();
  // Mount the eink hook here so the document class stays in sync on this page.
  useEink();

  const validSlug = SLUG_RE.test(slug);

  // Encryption state. Three phases:
  //  - "loading": waiting on enc metadata fetch
  //  - "needs-key": note is encrypted, waiting for user to enter the key
  //  - "ready": encryption (or lack thereof) is decided, provider can mount
  const [encPhase, setEncPhase] = useState<"loading" | "needs-key" | "ready">("loading");
  const [encMeta, setEncMeta] = useState<EncMeta>({ isEncrypted: false, salt: null, check: null });
  const [encryption, setEncryption] = useState<Encryption | null>(null);

  // Read enc metadata once per slug.
  useEffect(() => {
    if (!validSlug) return;
    setEncPhase("loading");
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("notes")
        .select("is_encrypted, enc_salt, enc_check")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      const meta: EncMeta = {
        isEncrypted: !!data?.is_encrypted,
        salt: data?.enc_salt ?? null,
        check: data?.enc_check ?? null,
      };
      setEncMeta(meta);

      if (!meta.isEncrypted) {
        setEncryption(null);
        setEncPhase("ready");
        return;
      }
      // Try the URL hash first.
      const hashKey = window.location.hash.startsWith("#")
        ? decodeURIComponent(window.location.hash.slice(1))
        : "";
      if (hashKey && meta.salt && meta.check) {
        try {
          const key = await deriveKey(hashKey, meta.salt);
          const ok = await verifyCheck(key, meta.check);
          if (ok) {
            setEncryption({
              encrypt: (b) => encryptBytes(key, b),
              decrypt: (b) => decryptBytes(key, b),
            });
            setEncPhase("ready");
            return;
          }
        } catch (e) {
          console.warn("derive failed", e);
        }
      }
      setEncPhase("needs-key");
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, validSlug]);

  // Build provider only once we know whether we have encryption (or none).
  const bundle = useMemo<ProviderBundle | null>(() => {
    if (!validSlug || encPhase !== "ready") return null;
    const doc = new Y.Doc();
    const provider = new SupabaseYjsProvider(slug, doc, encryption ?? undefined);
    return { provider, doc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, validSlug, encPhase]);

  useEffect(() => {
    if (!bundle) return;
    const { doc, provider } = bundle;
    // Keep encryption ref in sync (in case user locks/unlocks later).
    provider.setEncryption(encryption);

    const identity = getIdentity();
    if (!embedSlug) touchRecent(slug);

    const idb = new IndexeddbPersistence(`note:${slug}`, doc);

    const unsubStatus = provider.onStatus(setStatus);
    const unsubAwareness = provider.onAwareness((states) => {
      const list: PresenceUser[] = [];
      states.forEach((state, clientId) => {
        if (state?.user) {
          list.push({ clientId, name: state.user.name, color: state.user.color });
        }
      });
      setUsers(list);
    });

    const ytext = doc.getText("content");
    let prevContent = ytext.toString();
    let lastBigDeleteAt = 0;

    const updateCounts = () => {
      const text = ytext.toString();
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setCounts({ chars, words });

      const removed = prevContent.length - text.length;
      const now = Date.now();
      if (
        removed > SUDDEN_DELETE_THRESHOLD &&
        now - lastBigDeleteAt > SUDDEN_DELETE_WINDOW_MS &&
        prevContent.length >= SUDDEN_DELETE_THRESHOLD
      ) {
        lastBigDeleteAt = now;
        void recordOnSuddenDelete(slug, prevContent);
      }
      prevContent = text;
    };
    updateCounts();
    ytext.observe(updateCounts);

    idb.whenSynced.then(() => {
      provider.connect(identity).catch((e) => console.warn("Provider connect failed", e));
      prevContent = ytext.toString();
      updateCounts();
      void maybeSaveSnapshot(slug, prevContent);
    });

    const snapshotTimer = window.setInterval(() => {
      void maybeSaveSnapshot(slug, ytext.toString());
    }, SNAPSHOT_INTERVAL_MS);

    const handleBeforeUnload = () => {
      provider.saveSnapshot();
      void maybeSaveSnapshot(slug, ytext.toString());
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.clearInterval(snapshotTimer);
      ytext.unobserve(updateCounts);
      unsubStatus();
      unsubAwareness();
      provider.destroy();
      idb.destroy();
      doc.destroy();
    };
  }, [bundle, slug, embedSlug, encryption]);

  if (!validSlug) return <Navigate to="/" replace />;

  if (encPhase === "loading") {
    return <div className="h-svh bg-background" />;
  }

  if (encPhase === "needs-key") {
    return (
      <UnlockForm
        slug={slug}
        salt={encMeta.salt!}
        check={encMeta.check!}
        onUnlock={(key) => {
          setEncryption({
            encrypt: (b) => encryptBytes(key, b),
            decrypt: (b) => decryptBytes(key, b),
          });
          setEncPhase("ready");
        }}
      />
    );
  }

  if (!bundle) return null;
  const { doc, provider } = bundle;
  const getContent = () => doc.getText("content").toString();

  // SplitView wraps each panel — render the workspace without the global topbar.
  if (embedSlug) {
    return (
      <div className="flex h-full flex-col bg-background">
        <Editor doc={doc} awareness={provider.awareness} className="h-full overflow-auto" />
      </div>
    );
  }

  return (
    <div className="flex h-svh flex-col bg-background">
      <Topbar
        slug={slug}
        doc={doc}
        status={status}
        charCount={counts.chars}
        wordCount={counts.words}
        users={users}
        showPreview={showPreview}
        onTogglePreview={() => setShowPreview((v) => !v)}
        zen={zen}
        onToggleZen={toggleZen}
        getContent={getContent}
        isEncrypted={encMeta.isEncrypted}
        paginated={paginated}
        onTogglePagination={togglePagination}
      />

      <main className="flex flex-1 min-h-0 divide-x divide-border">
        <div className={showPreview ? "hidden md:block md:flex-1 min-w-0" : "flex-1 min-w-0"}>
          <Editor ref={editorRef} doc={doc} awareness={provider.awareness} className="h-full overflow-auto" />
        </div>
        {showPreview && (
          <div className={`flex-1 min-w-0 overflow-auto bg-muted/30 ${zen ? "zen-hide" : ""}`}>
            <Preview doc={doc} />
          </div>
        )}
      </main>

      <OutlineSidebar doc={doc} onJump={(line) => editorRef.current?.jumpToLine(line)} />

      {paginated && (
        <PageIndicator
          page={page}
          totalPages={totalPages}
          onPrev={() => flip(-1)}
          onNext={() => flip(1)}
        />
      )}

      <WordCountPill words={counts.words} chars={counts.chars} goal={goal} />
    </div>
  );
}
