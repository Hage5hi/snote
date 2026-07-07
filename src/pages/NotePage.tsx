import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { Editor, type EditorHandle } from "@/components/note/Editor";
import { Preview } from "@/components/note/Preview";
import { Topbar } from "@/components/note/Topbar";
import { UnlockForm } from "@/components/note/UnlockForm";
import { PageIndicator } from "@/components/note/PageIndicator";
import { GoalConfetti } from "@/components/note/GoalConfetti";

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
import { useNarrowViewport } from "@/hooks/use-narrow-viewport";
import { useScrollSyncEnabled } from "@/hooks/use-scroll-sync-enabled";
import { useScrollSync } from "@/hooks/use-scroll-sync";
import { useFocusLine } from "@/hooks/use-focus-line";
import { WIKI_NAV_EVENT } from "@/lib/wiki-link";
import { useEink } from "@/hooks/use-eink";
import { useVimMode } from "@/hooks/use-vim-mode";
import { usePagination } from "@/hooks/use-pagination";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { deriveKey, encryptBytes, decryptBytes, verifyCheck, iterationsFor } from "@/lib/crypto";
import { acquireDoc, releaseDoc } from "@/lib/yjs/doc-cache";
import { AppShell } from "@/components/app/AppShell";
import { isExtensionContext } from "@/lib/ext-context";

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
  // On narrow viewports (< 900 px) the editor + preview are NOT shown
  // side-by-side. Instead, the preview toggle swaps the visible pane between
  // editor and rendered markdown. `showPreview` keeps the same semantic
  // meaning ("user wants to see the preview") and is the only piece of state
  // we need — layout logic below derives both modes from it.
  const narrow = useNarrowViewport();
  const showEditorPane = !narrow || !showPreview;
  const showPreviewPane = showPreview;
  const { enabled: scrollSync, toggle: toggleScrollSync } = useScrollSyncEnabled();
  const [editorScrollEl, setEditorScrollEl] = useState<HTMLElement | null>(null);
  const [previewScrollEl, setPreviewScrollEl] = useState<HTMLElement | null>(null);
  // Scroll sync only makes sense when BOTH panes are visible at the same
  // time. On narrow viewports only one pane is rendered, so disable.
  useScrollSync(editorScrollEl, previewScrollEl, scrollSync && showPreview && !narrow);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [counts, setCounts] = useState({ chars: 0, words: 0 });
  const { goal } = useWordGoal(slug);
  const { t } = useI18n();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  // Mount Y.Doc IMMEDIATELY (synchronously) — no waiting on enc-meta or any
  // fetch. The doc-cache returns the previously-warm doc when navigating
  // back so re-opens are essentially free.
  const doc = useMemo(() => (validSlug ? acquireDoc(slug) : null), [slug, validSlug]);

  // Provider is bound to (slug, doc, encryption mode). Bumping `providerEpoch`
  // on any encryption-mode flip forces a full teardown + rebuild — no stale
  // instance can survive a lock/unlock and write in the wrong mode.
  const [providerEpoch, setProviderEpoch] = useState(0);
  const provider = useMemo(
    () => (validSlug && doc ? new SupabaseYjsProvider(slug, doc) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug, validSlug, doc, providerEpoch],
  );

  // Celebrate when crossing the goal threshold (once per goal value).
  // `confettiTrigger` bumps in lockstep with the toast so a CSS-only burst
  // fires alongside the notification (U6).
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  useEffect(() => {
    if (consumeGoalReached(slug, counts.words, goal)) {
      toast({
        title: t("note.goal_reached"),
        description: `${counts.words.toLocaleString()} / ${goal!.toLocaleString()}`,
      });
      setConfettiTrigger((n) => n + 1);
    }
  }, [slug, counts.words, goal, t]);

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

  // Bumped by the hashchange listener so the meta-fetch effect re-runs when
  // the encryption key in the URL fragment changes (lock/unlock flows).
  const [metaVersion, setMetaVersion] = useState(0);
  useEffect(() => {
    const onHash = () => setMetaVersion((n) => n + 1);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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
      setEncMeta((prev) => {
        // Encryption mode flipped since last fetch — force a provider rebuild.
        if (prev.isEncrypted !== meta.isEncrypted) {
          setProviderEpoch((n) => n + 1);
        }
        return meta;
      });


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
  }, [slug, validSlug, metaVersion]);

  // When inside the Syrin Note Chrome extension side panel, tell the host
  // which slug we're on so it can remember the last-opened note. We retry
  // up to 3 times (1s apart) if the host doesn't ack within 500ms — covers
  // the race where the side panel's listener attaches after our first post.
  useEffect(() => {
    if (!isExtensionContext || !validSlug || embedSlug) return;
    if (typeof window === "undefined" || window.parent === window) return;
    const debug = (() => {
      try {
        return localStorage.getItem("syrin:debug") === "1";
      } catch {
        return false;
      }
    })();
    const dlog = (...args: unknown[]) => {
      if (debug) console.log("[syrin-note][debug][web]", ...args);
    };
    // Strict origin: derive from document.referrer (the extension host).
    let targetOrigin = "*";
    try {
      if (document.referrer) targetOrigin = new URL(document.referrer).origin;
    } catch {
      /* keep "*" */
    }
    let acked = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const d = e.data;
      if (d && typeof d === "object" && d.type === "syrin:ack" && d.slug === slug) {
        acked = true;
        dlog("ack received", slug, "after attempts=", attempts);
        if (timer) clearTimeout(timer);
      }
    };
    window.addEventListener("message", onMessage);
    const sendOnce = () => {
      try {
        window.parent.postMessage({ type: "syrin:slug", slug }, targetOrigin);
        dlog("posted slug", slug, "→", targetOrigin, "attempt", attempts + 1);
      } catch (err) {
        dlog("post failed", err);
      }
      attempts += 1;
      timer = setTimeout(() => {
        if (acked) return;
        if (attempts >= 3) {
          dlog("giving up after 3 attempts");
          return;
        }
        sendOnce();
      }, attempts === 1 ? 500 : 1000);
    };
    sendOnce();
    return () => {
      window.removeEventListener("message", onMessage);
      if (timer) clearTimeout(timer);
    };
  }, [slug, validSlug, embedSlug]);



  // Mount IDB + connect provider once enc decision is made.
  useEffect(() => {
    if (!validSlug || !doc || !provider || encPhase !== "ready") return;
    provider.setEncryption(encryption);
    provider.setExpectedEncrypted(encMeta.isEncrypted);

    const identity = getIdentity();
    if (!embedSlug) touchRecent(slug);

    const idb = new IndexeddbPersistence(`note:${slug}`, doc);
    let disposed = false;

    
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
          title: tRef.current("toast.synced_remote"),
          description: tRef.current("toast.synced_remote_desc", { bytes: ev.bytes }),
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
      if (disposed) return;
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
      if (disposed) return;
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
      if (disposed) return;
      // sendBeacon survives the page teardown; sync supabase fetch may not.
      provider.flushBeacon();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      disposed = true;
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
        <div
          className={
            narrow
              ? "flex flex-1 min-h-0 flex-col"
              : "flex flex-1 min-h-0 flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0"
          }
        >
          {showEditorPane && (
            <div className="flex-1 min-h-0 min-w-0">
              <Editor doc={doc} awareness={provider.awareness} className="h-full overflow-auto" vim={vim} />
            </div>
          )}
          {showPreviewPane && (
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
  const noteDesc = `Note "${slug}" on Syrin Notes — realtime markdown, autosave, synced across devices.`;

  return (
    <AppShell className="flex h-svh flex-col">


      <Helmet>
        <title>{noteTitle}</title>
        <meta name="description" content={noteDesc} />
        <link rel="canonical" href={noteUrl} />
        <meta property="og:title" content={noteTitle} />
        <meta property="og:description" content={noteDesc} />
        <meta property="og:url" content={noteUrl} />
        {/* eslint-disable-next-line no-restricted-syntax -- SEO control value */}
        <meta property="og:type" content="article" />
        <meta name="twitter:title" content={noteTitle} />
        <meta name="twitter:description" content={noteDesc} />
        {/* eslint-disable-next-line no-restricted-syntax -- SEO control value */}
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

      <main
        className={
          narrow
            ? "relative flex flex-1 min-h-0 flex-col"
            : "relative flex flex-1 min-h-0 flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0"
        }
      >
        {showEditorPane && (
          <div className={showPreviewPane && !narrow ? "flex-1 min-h-0 min-w-0" : "flex-1 min-w-0"}>
            <Editor
              ref={editorRef}
              doc={doc}
              awareness={provider.awareness}
              className="h-full overflow-auto"
              onScrollEl={setEditorScrollEl}
              vim={vim}
            />
          </div>
        )}
        {showPreviewPane && (
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

        {encPhase === "loading" && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm"
            aria-busy="true"
            aria-live="polite"
            // Swallow pointer events so no keystrokes/clicks reach the editor
            // while the provider is being (re)built after a lock/unlock.
          >
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </main>

      <OutlineSidebar doc={doc} onJump={(line) => editorRef.current?.jumpToLine(line)} />

      <GoalConfetti trigger={confettiTrigger} />

      {paginated && (
        <PageIndicator
          page={page}
          totalPages={totalPages}
          onPrev={() => flip(-1)}
          onNext={() => flip(1)}
        />
      )}
    </AppShell>
  );
}
