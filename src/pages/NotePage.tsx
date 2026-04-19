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

type ProviderBundle = { provider: SupabaseYjsProvider; doc: Y.Doc };

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export default function NotePage() {
  const { slug = "" } = useParams();
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  const [showPreview, setShowPreview] = useState(!isMobile);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [counts, setCounts] = useState({ chars: 0, words: 0 });

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

    // Counts observer.
    const ytext = doc.getText("content");
    const updateCounts = () => {
      const text = ytext.toString();
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setCounts({ chars, words });
    };
    updateCounts();
    ytext.observe(updateCounts);

    // Connect after IDB has loaded local state, so we don't double-apply.
    idb.whenSynced.then(() => {
      provider.connect(identity).catch((e) => console.warn("Provider connect failed", e));
      updateCounts();
    });

    // Save snapshot when leaving the page.
    const handleBeforeUnload = () => {
      provider.saveSnapshot();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
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
        status={status}
        charCount={counts.chars}
        wordCount={counts.words}
        users={users}
        showPreview={showPreview}
        onTogglePreview={() => setShowPreview((v) => !v)}
        getContent={getContent}
      />

      <main className="flex flex-1 min-h-0 divide-x divide-border">
        <div className={showPreview ? "hidden md:block md:flex-1 min-w-0" : "flex-1 min-w-0"}>
          <Editor doc={doc} awareness={provider.awareness} className="h-full overflow-auto" />
        </div>
        {showPreview && (
          <div className="flex-1 min-w-0 overflow-auto bg-muted/30">
            <Preview doc={doc} />
          </div>
        )}
      </main>
    </div>
  );
}
