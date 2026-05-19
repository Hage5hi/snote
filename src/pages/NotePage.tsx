import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { Editor, type EditorHandle } from "@/components/note/Editor";
import { Preview } from "@/components/note/Preview";
import { Topbar } from "@/components/note/Topbar";
import { UnlockForm } from "@/components/note/UnlockForm";
import { PageIndicator } from "@/components/note/PageIndicator";

import { useWordGoal, consumeGoalReached } from "@/hooks/use-word-goal";
import { toast } from "@/hooks/use-toast";
import { OutlineSidebar } from "@/components/note/OutlineSidebar";
import { SupabaseYjsProvider, type Encryption } from "@/lib/yjs/provider";
import { getIdentity } from "@/lib/yjs/identity";
import { touchRecent } from "@/lib/recent-notes";
import type { PresenceUser } from "@/components/note/PresenceDots";
import { maybeSaveSnapshot, recordOnSuddenDelete } from "@/lib/snapshots";
import { useZenMode } from "@/hooks/use-zen-mode";
import { useTypewriterMode } from "@/hooks/use-typewriter-mode";
import { usePreviewVisible } from "@/hooks/use-preview-visible";
import { useScrollSyncEnabled } from "@/hooks/use-scroll-sync-enabled";
import { useScrollSync } from "@/hooks/use-scroll-sync";
import { useFocusLine } from "@/hooks/use-focus-line";
import { WIKI_NAV_EVENT } from "@/lib/wiki-link";
import { useEink } from "@/hooks/use-eink";
import { useVimMode } from "@/hooks/use-vim-mode";
import { usePagination } from "@/hooks/use-pagination";
import { supabase } from "@/integrations/supabase/client";
import { deriveKey, encryptBytes, decryptBytes, verifyCheck, iterationsFor } from "@/lib/crypto";
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
  iterations: number | null;
  ydocState: string | null;
  rowExists: boolean;
};

export default function NotePage({ embedSlug }: NotePageProps) {
  const params = useParams();
  const slug = embedSlug ?? params.slug ?? "";
  const validSlug = SLUG_RE.test(slug);
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  const { visible: showPreview, setVisible: setShowPreview } = usePreviewVisible();
  const { enabled: scrollSync, toggle: toggleScrollSync } = useScrollSyncEnabled();
  const [editorScrollEl, setEditorScrollEl] = useState<HTMLElement | null>(null);
  const [previewScrollEl, setPreviewScrollEl] = useState<HTMLElement | null>(null);
  useScrollSync(editorScrollEl, previewScrollEl, scrollSync && showPreview);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [counts, setCounts] = useState({ chars: 0, words: 0 });
  const { goal } = useWordGoal(slug);

  // Mount Y.Doc IMMEDIATELY (synchronously) — no waiting on enc-meta or any
  // fetch. The doc-cache returns the previously-warm doc when navigating
  // back so re-opens are essentially free.
  const doc = useMemo(() => (validSlug ? acquireDoc(slug) : null), [slug, validSlug]);

  // Provider is bound to (slug, doc). Recreated whenever either changes —
  // critical so navigating to a new slug (e.g. after rename) gets a fresh
  // provider instead of dereferencing a destroyed one.
  const provider = useMemo(
    () => (validSlug && doc ? new SupabaseYjsProvider(slug, doc) : null),
    [slug, validSlug, doc],
  );

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
  const { typewriter, toggle: toggleTypewriter } = useTypewriterMode();
  const { vim } = useVimMode();
  const { focusLine, toggle: toggleFocusLine } = useFocusLine();
  const navigate = useNavigate();

  // Ctrl/Cmd+Click on a `[[slug]]` token in the editor dispatches this event.
  // Skip in embed (SplitView) mode — otherwise both panels would navigate and
  // push duplicate history entries.
  useEffect(() => {
    if (embedSlug) return;
    const onNav = (e: Event) => {
      const target = (e as CustomEvent<{ slug: string }>).detail?.slug;
      if (target) navigate("/" + target);
    };
    window.addEventListener(WIKI_NAV_EVENT, onNav);
    return () => window.removeEventListener(WIKI_NAV_EVENT, onNav);
  }, [navigate, embedSlug]);

  // Per-note head tags rendered via react-helmet-async below (in JSX).
  const { enabled: paginated, toggle: togglePagination, flip, page, totalPages } = usePagination();
  useEink();

  // Encryption phases: "loading" (waiting on enc-meta), "needs-key", "ready".
  // Editor mounts during "loading" too — only the network sync is gated.
  const [encPhase, setEncPhase] = useState<"loading" | "needs-key" | "ready">("loading");
  const [encMeta, setEncMeta] = useState<EncMeta>({
    isEncrypted: false,
    salt: null,
    check: null,
    iterations: null,
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
        .select("is_encrypted, enc_salt, enc_check, enc_iterations, ydoc_state")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      const meta: EncMeta = {
        isEncrypted: !!data?.is_encrypted,
        salt: data?.enc_salt ?? null,
        check: data?.enc_check ?? null,
        iterations: data?.enc_iterations ?? null,
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
          const key = await deriveKey(hashKey, meta.salt, iterationsFor(meta.iterations));
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
    if (!validSlug || !doc || !provider || encPhase !== "ready") return;
    provider.setEncryption(encryption);

    const identity = getIdentity();
    if (!embedSlug) touchRecent(slug);

    const idb = new IndexeddbPersistence(`note:${slug}`, doc);

    
    const unsubAwareness = provider.onAwareness((states) => {
      const list: PresenceUser[] = [];
      states.forEach((state, clientId) => {
        if (state?.user) {
          list.push({ clientId, name: state.user.name, color: state.user.color });
        }
      });
      setUsers(list);
    });

    // Phase 2.2 — toast on `recovered` (DB had updates we didn't on reconnect).
    // Conflict events are surfaced by SyncIndicator's pill+popover, not a toast.
    const unsubSync = provider.onSyncEvent((ev) => {
      if (ev.type === "recovered") {
        toast({
          title: "Đã đồng bộ từ thiết bị khác",
          description: `Hợp nhất ${ev.bytes} byte mới từ cloud.`,
        });
      }
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
      
      unsubAwareness();
      unsubSync();
      void provider.destroy();
      idb.destroy();
      // Doc itself stays warm in cache for fast re-open; only release.
      releaseDoc(slug);
    };
  }, [slug, validSlug, doc, provider, embedSlug, encPhase, encryption, encMeta.ydocState, encMeta.rowExists]);

  if (!validSlug) return <Navigate to="/" replace />;
  if (!doc || !provider) return null;
  const getContent = () => doc.getText("content").toString();

  // SplitView wraps each panel — render the workspace without the global topbar.
  // SplitView wraps each panel — render compact topbar + editor (+ preview if toggled).
  // Compact topbar hides app-wide toggles (zen, theme, settings) but keeps
  // per-note actions (preview toggle, lock, share, rename, status, presence).
  if (embedSlug) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <Topbar
          slug={slug}
          doc={doc}
          provider={provider}
          charCount={counts.chars}
          wordCount={counts.words}
          users={users}
          showPreview={showPreview}
          onTogglePreview={() => setShowPreview((v) => !v)}
          scrollSync={scrollSync}
          onToggleScrollSync={toggleScrollSync}
          zen={zen}
          onToggleZen={toggleZen}
          typewriter={typewriter}
          onToggleTypewriter={toggleTypewriter}
          focusLine={focusLine}
          onToggleFocusLine={toggleFocusLine}
          getContent={() => doc.getText("content").toString()}
          isEncrypted={encMeta.isEncrypted}
          paginated={paginated}
          onTogglePagination={togglePagination}
          compact
        />
        <div className="flex flex-1 min-h-0 flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0">
          <div className="flex-1 min-h-0 min-w-0">
            <Editor doc={doc} awareness={provider.awareness} className="h-full overflow-auto" vim={vim} />
          </div>
          {showPreview && (
            <div className="flex-1 min-h-0 min-w-0 overflow-auto bg-muted/30">
              <Preview doc={doc} />
            </div>
          )}
        </div>
      </div>
    );
  }

  const showUnlockOverlay = encPhase === "needs-key";

  const noteUrl = `https://syrin.online/${slug}`;
  const noteTitle = `${slug} — Syrin Notes`;
  const noteDesc = `Note "${slug}" trên Syrin Notes — markdown realtime, tự động lưu, đồng bộ giữa các thiết bị.`;

  return (
    <div className="flex h-svh flex-col bg-background">
      <Helmet>
        <title>{noteTitle}</title>
        <meta name="description" content={noteDesc} />
        <link rel="canonical" href={noteUrl} />
        <meta property="og:title" content={noteTitle} />
        <meta property="og:description" content={noteDesc} />
        <meta property="og:url" content={noteUrl} />
        <meta property="og:type" content="article" />
        <meta name="twitter:title" content={noteTitle} />
        <meta name="twitter:description" content={noteDesc} />
        {encMeta.isEncrypted && <meta name="robots" content="noindex" />}
      </Helmet>
      <Topbar
        slug={slug}
        doc={doc}
        provider={provider}
        charCount={counts.chars}
        wordCount={counts.words}
        users={users}
        showPreview={showPreview}
        onTogglePreview={() => setShowPreview((v) => !v)}
        scrollSync={scrollSync}
        onToggleScrollSync={toggleScrollSync}
        zen={zen}
        onToggleZen={toggleZen}
        typewriter={typewriter}
        onToggleTypewriter={toggleTypewriter}
        focusLine={focusLine}
        onToggleFocusLine={toggleFocusLine}
        getContent={getContent}
        isEncrypted={encMeta.isEncrypted}
        paginated={paginated}
        onTogglePagination={togglePagination}
      />

      <main className="relative flex flex-1 min-h-0 flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0">
        <div className={showPreview ? "flex-1 min-h-0 min-w-0" : "flex-1 min-w-0"}>
          <Editor
            ref={editorRef}
            doc={doc}
            awareness={provider.awareness}
            className="h-full overflow-auto"
            onScrollEl={setEditorScrollEl}
            vim={vim}
          />
        </div>
        {showPreview && (
          <div
            ref={setPreviewScrollEl}
            className={`flex-1 min-h-0 min-w-0 overflow-auto bg-muted/30 ${zen ? "zen-hide" : ""}`}
          >
            <Preview doc={doc} />
          </div>
        )}

        {showUnlockOverlay && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
            <UnlockForm
              slug={slug}
              salt={encMeta.salt!}
              check={encMeta.check!}
              iterations={iterationsFor(encMeta.iterations)}
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
    </div>
  );
}
