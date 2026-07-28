import { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { deriveKey, verifyCheck, iterationsFor } from "@/lib/crypto";
import { supabase } from "@/integrations/supabase/client";

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

type RawViewState = {
  target: string;
  text: string | null;
  error: string | null;
};

/**
 * RawView renders plaintext markdown of a note inside a <pre>.
 * - For unencrypted notes, fetches `content` directly from the DB (cached).
 * - For encrypted notes, requires a `?key=...` query OR `#key` URL hash; decrypts
 *   client-side and renders the result. Server stays zero-knowledge.
 *
 * Path: /:slug.md  (route registered in App.tsx)
 */
export default function RawView() {
  const params = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Single-segment route — App.tsx routes anything ending in `.md` here.
  const slugMd = params.slug ?? "";
  const slug = slugMd.replace(/\.md$/i, "");
  const routeTarget = `${location.pathname}\u0000${location.search}\u0000${location.hash}`;
  const [viewState, setViewState] = useState<RawViewState | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    document.documentElement.classList.add("raw-view");
    return () => document.documentElement.classList.remove("raw-view");
  }, []);

  useEffect(() => {
    const requestTarget = routeTarget;
    const generation = ++generationRef.current;
    let cancelled = false;
    let expectedPathname = location.pathname;
    let expectedSearch = location.search;
    let expectedHash = location.hash;
    const isCurrent = () => (
      !cancelled
      && generationRef.current === generation
      && window.location.pathname === expectedPathname
      && window.location.search === expectedSearch
      && window.location.hash === expectedHash
    );
    const commitError = (message: string) => {
      if (isCurrent()) setViewState({ target: requestTarget, text: null, error: message });
    };
    const commitText = (value: string) => {
      if (isCurrent()) setViewState({ target: requestTarget, text: value, error: null });
    };
    setViewState({ target: requestTarget, text: null, error: null });
    (async () => {
      if (!SLUG_RE.test(slug)) {
        commitError("Invalid slug.");
        return;
      }
      const { data, error: dbError } = await supabase
        .from("notes")
        .select("content, ydoc_state, is_encrypted, enc_salt, enc_check, enc_iterations")
        .eq("slug", slug)
        .maybeSingle();
      if (!isCurrent()) return;
      if (dbError) {
        commitError(dbError.message);
        return;
      }
      if (!data) {
        commitError(`Note /${slug} does not exist.`);
        return;
      }
      if (!data.is_encrypted) {
        commitText(data.content ?? "");
        return;
      }
      // Encrypted: pull key from URL hash (#key) ONLY.
      // Hash fragments are never sent to servers, never appear in Referer
      // headers, and are not captured by most logging/analytics — unlike
      // query params. Backward-compat with `?key=`: migrate to hash, then
      // strip the query param before doing anything else with the key.
      let hashKey = window.location.hash.startsWith("#")
        ? decodeURIComponent(window.location.hash.slice(1))
        : "";
      const legacyQueryKey = searchParams.get("key");
      if (!hashKey && legacyQueryKey) {
        hashKey = legacyQueryKey;
        try {
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}#${encodeURIComponent(legacyQueryKey)}`
          );
          expectedPathname = window.location.pathname;
          expectedSearch = window.location.search;
          expectedHash = window.location.hash;
        } catch {
          // ignore
        }
      }
      const key = hashKey;
      if (!key) {
        commitError("This note is encrypted. Append `#<key>` to the URL to view.");
        return;
      }
      if (!data.enc_salt || !data.enc_check || !data.ydoc_state) {
        commitError("Missing encryption metadata.");
        return;
      }
      try {
        const cryptoKey = await deriveKey(key, data.enc_salt, iterationsFor(data.enc_iterations));
        if (!isCurrent()) return;
        const ok = await verifyCheck(cryptoKey, data.enc_check);
        if (!isCurrent()) return;
        if (!ok) {
          commitError("Wrong key.");
          return;
        }
        // ydoc_state is encrypted Y.update, but for raw plaintext output we
        // need the actual text. We piggy-back: the editor stores the same
        // plaintext as a separate sentinel? We don't — so derive plain text by
        // applying the decrypted Y update into a fresh Y.Doc.
        const Y = await import("yjs");
        if (!isCurrent()) return;
        const { base64ToBytes } = await import("@/lib/yjs/base64");
        if (!isCurrent()) return;
        const { decryptBytes } = await import("@/lib/crypto");
        if (!isCurrent()) return;
        const decrypted = await decryptBytes(cryptoKey, base64ToBytes(data.ydoc_state));
        if (!isCurrent()) return;
        const tmp = new Y.Doc();
        Y.applyUpdate(tmp, decrypted);
        if (!isCurrent()) {
          tmp.destroy();
          return;
        }
        commitText(tmp.getText("content").toString());
        tmp.destroy();
      } catch (e) {
        if (!isCurrent()) return;
        console.error(e);
        commitError("Decryption failed.");
      }
    })().catch((cause) => {
      commitError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [slug, searchParams, routeTarget, location.pathname, location.search, location.hash]);

  // Route changes render before passive effects run. Never display the
  // previous route's plaintext under the new URL, even for a single frame.
  const visibleState = viewState?.target === routeTarget ? viewState : null;
  const error = visibleState?.error ?? null;
  const text = visibleState?.text ?? null;

  const head = (
    <Helmet>
      <title>{`Raw markdown: /${slug}.md — Syrin Notes`}</title>
      <meta name="description" content={`View plain markdown (plaintext) of note /${slug} on Syrin Notes — no rendering, no UI.`} />
      <link rel="canonical" href={`https://note.syrin.online/${slug}.md`} />
      {/* eslint-disable-next-line no-restricted-syntax -- SEO control value */}
      <meta name="robots" content="noindex, follow" />
      <meta property="og:title" content={`Raw markdown: /${slug}.md — Syrin Notes`} />
      <meta property="og:description" content={`Plaintext markdown of note /${slug} on Syrin Notes.`} />
      <meta property="og:url" content={`https://note.syrin.online/${slug}.md`} />
      <meta name="twitter:title" content={`Raw markdown: /${slug}.md — Syrin Notes`} />
      <meta name="twitter:description" content={`Plaintext markdown of note /${slug}.`} />
    </Helmet>
  );
  if (error) {
    return (
      <>
        {head}
        <pre className="raw-pre">{`# ${error}`}</pre>
      </>
    );
  }
  if (text === null) {
    return (
      <>
        {head}
        <pre className="raw-pre"># loading…</pre>
      </>
    );
  }
  return (
    <>
      {head}
      <pre className="raw-pre">{text}</pre>
    </>
  );
}
