import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { Editor } from "@/components/note/Editor";
import { Preview } from "@/components/note/Preview";
import { Topbar } from "@/components/note/Topbar";
import { SupabaseYjsProvider, type SaveStatus } from "@/lib/yjs/provider";
import { getIdentity } from "@/lib/yjs/identity";
import { touchRecent } from "@/lib/recent-notes";
import type { PresenceUser } from "@/components/note/PresenceDots";
import { maybeSaveSnapshot, recordOnSuddenDelete } from "@/lib/snapshots";
import { useZenMode } from "@/hooks/use-zen-mode";
import { useEink } from "@/hooks/use-eink";

type ProviderBundle = { provider: SupabaseYjsProvider; doc: Y.Doc };

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SUDDEN_DELETE_THRESHOLD = 500; // chars
const SUDDEN_DELETE_WINDOW_MS = 2000;

export default function NotePage() {
  const { slug = "" } = useParams();
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  const [showPreview, setShowPreview] = useState(!isMobile);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [counts, setCounts] = useState({ chars: 0, words: 0 });
  const { zen, toggle: toggleZen } = useZenMode();
  // Mount the eink hook here so the document class stays in sync on this page.
  useEink();

  const validSlug = SLUG_RE.test(slug);

  // Stable doc + provider per slug. Created together so the editor always has a
  // valid awareness instance to bind to.
  const bundle = useMemo<ProviderBundle | null>(() => {
    if (!validSlug) return null;
    const doc = new Y.Doc();
    const provider = new SupabaseYjsProvider(slug, doc);
    return { provider, doc };
  }, [slug, validSlug]);
  const indexeddbRef = useRef<IndexeddbPersistence | null>(null);

  useEffect(() => {
    if (!bundle) return;
    const { doc, provider } = bundle;

    const identity = getIdentity();
    touchRecent(slug);

    // Local-first persistence.
    const idb = new IndexeddbPersistence(`note:${slug}`, doc);
    indexeddbRef.current = idb;

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

    // Counts observer + anti-disaster snapshot detection.
    const ytext = doc.getText("content");
    let prevContent = ytext.toString();
    let lastBigDeleteAt = 0;

    const updateCounts = () => {
      const text = ytext.toString();
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setCounts({ chars, words });

      // Anti-disaster: large delete in a short window → snapshot the prior text.
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

    // Connect after IDB has loaded local state, so we don't double-apply.
    idb.whenSynced.then(() => {
      provider.connect(identity).catch((e) => console.warn("Provider connect failed", e));
      prevContent = ytext.toString();
      updateCounts();
      // First periodic snapshot kick after sync.
      void maybeSaveSnapshot(slug, prevContent);
    });

    // Periodic local snapshots (every 10 minutes).
    const snapshotTimer = window.setInterval(() => {
      void maybeSaveSnapshot(slug, ytext.toString());
    }, SNAPSHOT_INTERVAL_MS);

    // Save snapshot when leaving the page.
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
      indexeddbRef.current = null;
    };
  }, [bundle, slug]);

  if (!validSlug) return <Navigate to="/" replace />;
  if (!bundle) return null;

  const { doc, provider } = bundle;
  const getContent = () => doc.getText("content").toString();

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
      />

      <main className="flex flex-1 min-h-0 divide-x divide-border">
        <div className={showPreview ? "hidden md:block md:flex-1 min-w-0" : "flex-1 min-w-0"}>
          <Editor doc={doc} awareness={provider.awareness} className="h-full overflow-auto" />
        </div>
        {showPreview && (
          <div className={`flex-1 min-w-0 overflow-auto bg-muted/30 ${zen ? "zen-hide" : ""}`}>
            <Preview doc={doc} />
          </div>
        )}
      </main>
    </div>
  );
}
