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
import { acquireDoc, releaseDoc } from "@/lib/yjs/doc-cache";

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const SUDDEN_DELETE_THRESHOLD = 500;
const SUDDEN_DELETE_WINDOW_MS = 2000;
const COUNT_DEBOUNCE_MS = 150;

interface NotePageProps {
  /** When provided (e.g. from SplitView), use this slug instead of the route param. */
  embedSlug?: string;
}

type EncMeta = {
  isEncrypted: boolean;
  salt: string | null;
  check: string | null;
  ydocState: string | null;
  rowExists: boolean;
};

export default function NotePage({ embedSlug }: NotePageProps) {
  const params = useParams();
  const slug = embedSlug ?? params.slug ?? "";
  const validSlug = SLUG_RE.test(slug);
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [counts, setCounts] = useState({ chars: 0, words: 0 });
  const { goal } = useWordGoal(slug);

  // Mount Y.Doc IMMEDIATELY (synchronously) — no waiting on enc-meta or any
  // fetch. The doc-cache returns the previously-warm doc when navigating
  // back so re-opens are essentially free.
  const doc = useMemo(() => (validSlug ? acquireDoc(slug) : null), [slug, validSlug]);

  // Provider is created alongside the doc and reused; encryption hooks are
  // attached later if/when they become available.
  const providerRef = useRef<SupabaseYjsProvider | null>(null);
  if (validSlug && doc && !providerRef.current) {
    providerRef.current = new SupabaseYjsProvider(slug, doc);
  }

  // Celebrate when crossing the goal threshold (once per goal value).
  useEffect(() => {
    if (consumeGoalReached(slug, counts.words, goal)) {
      toast({
        title: "🎯 Đạt mục tiêu!",
        description: `${counts.words.toLocaleString()} / ${goal!.toLocaleString()} từ`,
      });
    }
  }, [slug, counts.words, goal]);

  const editorRef = useRef<EditorHandle>(null);
  const { zen, toggle: toggleZen } = useZenMode();
  const { enabled: paginated, toggle: togglePagination, flip, page, totalPages } = usePagination();
  useEink();

  // Encryption phases: "loading" (waiting on enc-meta), "needs-key", "ready".
  // Editor mounts during "loading" too — only the network sync is gated.
  const [encPhase, setEncPhase] = useState<"loading" | "needs-key" | "ready">("loading");
  const [encMeta, setEncMeta] = useState<EncMeta>({
    isEncrypted: false,
    salt: null,
    check: null,
    ydocState: null,
    rowExists: false,
  });
  const [encryption, setEncryption] = useState<Encryption | null>(null);

  // Single combined fetch: enc-meta + ydoc_state in one round-trip.
  useEffect(() => {
    if (!validSlug) return;
    setEncPhase("loading");
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("notes")
        .select("is_encrypted, enc_salt, enc_check, ydoc_state")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      const meta: EncMeta = {
        isEncrypted: !!data?.is_encrypted,
        salt: data?.enc_salt ?? null,
        check: data?.enc_check ?? null,
        ydocState: data?.ydoc_state ?? null,
        rowExists: !!data,
      };
      setEncMeta(meta);

      if (!meta.isEncrypted) {
        setEncryption(null);
        setEncPhase("ready");
        return;
      }
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

  // Mount IDB + connect provider once enc decision is made.
  useEffect(() => {
    if (!validSlug || !doc || encPhase !== "ready") return;
    const provider = providerRef.current!;
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

    // Debounced counts: avoid string scan + setState on every keystroke.
    let countTimer: number | null = null;
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
    const scheduleCounts = () => {
      if (countTimer) window.clearTimeout(countTimer);
      countTimer = window.setTimeout(updateCounts, COUNT_DEBOUNCE_MS);
    };
    updateCounts();
    ytext.observe(scheduleCounts);

    idb.whenSynced.then(() => {
      provider
        .connect(identity, {
          prefetchedYdocState: encMeta.ydocState,
          rowExists: encMeta.rowExists,
        })
        .catch((e) => console.warn("Provider connect failed", e));
      prevContent = ytext.toString();
      updateCounts();
      void maybeSaveSnapshot(slug, prevContent);
    });

    // Pause snapshot interval while tab hidden; flush when visible again.
    let snapshotTimer = window.setInterval(() => {
      void maybeSaveSnapshot(slug, ytext.toString());
    }, SNAPSHOT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        window.clearInterval(snapshotTimer);
        // Best-effort flush before browser may freeze the tab.
        void maybeSaveSnapshot(slug, ytext.toString());
      } else {
        snapshotTimer = window.setInterval(() => {
          void maybeSaveSnapshot(slug, ytext.toString());
        }, SNAPSHOT_INTERVAL_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const handleBeforeUnload = () => {
      // sendBeacon survives the page teardown; sync supabase fetch may not.
      provider.flushBeacon();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(snapshotTimer);
      if (countTimer) window.clearTimeout(countTimer);
      ytext.unobserve(scheduleCounts);
      unsubStatus();
      unsubAwareness();
      void provider.destroy();
      providerRef.current = null;
      idb.destroy();
      // Doc itself stays warm in cache for fast re-open; only release.
      releaseDoc(slug);
    };
  }, [slug, validSlug, doc, embedSlug, encPhase, encryption, encMeta.ydocState, encMeta.rowExists]);

  if (!validSlug) return <Navigate to="/" replace />;
  if (!doc) return null;
  const provider = providerRef.current!;
  const getContent = () => doc.getText("content").toString();

  // SplitView wraps each panel — render the workspace without the global topbar.
  if (embedSlug) {
    return (
      <div className="flex h-full flex-col bg-background">
        <Editor doc={doc} awareness={provider.awareness} className="h-full overflow-auto" />
      </div>
    );
  }

  const showUnlockOverlay = encPhase === "needs-key";

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

      <main className="relative flex flex-1 min-h-0 divide-x divide-border">
        <div className={showPreview ? "hidden md:block md:flex-1 min-w-0" : "flex-1 min-w-0"}>
          <Editor ref={editorRef} doc={doc} awareness={provider.awareness} className="h-full overflow-auto" />
        </div>
        {showPreview && (
          <div className={`flex-1 min-w-0 overflow-auto bg-muted/30 ${zen ? "zen-hide" : ""}`}>
            <Preview doc={doc} />
          </div>
        )}

        {showUnlockOverlay && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
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
