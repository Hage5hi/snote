import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { deriveKey, verifyCheck, iterationsFor } from "@/lib/crypto";

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

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
  const [searchParams] = useSearchParams();
  // Single-segment route — App.tsx routes anything ending in `.md` here.
  const slugMd = params.slug ?? "";
  const slug = slugMd.replace(/\.md$/i, "");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("raw-view");
    return () => document.documentElement.classList.remove("raw-view");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!SLUG_RE.test(slug)) {
        setError("Invalid slug.");
        return;
      }
      const { data, error: dbError } = await supabase
        .from("notes")
        .select("content, ydoc_state, is_encrypted, enc_salt, enc_check, enc_iterations")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (dbError) {
        setError(dbError.message);
        return;
      }
      if (!data) {
        setError(`Note /${slug} does not exist.`);
        return;
      }
      if (!data.is_encrypted) {
        setText(data.content ?? "");
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
            null,
            "",
            `${window.location.pathname}#${encodeURIComponent(legacyQueryKey)}`
          );
        } catch {
          // ignore
        }
      }
      const key = hashKey;
      if (!key) {
        setError("This note is encrypted. Append `#<key>` to the URL to view.");
        return;
      }
      if (!data.enc_salt || !data.enc_check || !data.ydoc_state) {
        setError("Missing encryption metadata.");
        return;
      }
      try {
        const cryptoKey = await deriveKey(key, data.enc_salt, iterationsFor(data.enc_iterations));
        const ok = await verifyCheck(cryptoKey, data.enc_check);
        if (!ok) {
          setError("Wrong key.");
          return;
        }
        // ydoc_state is encrypted Y.update, but for raw plaintext output we
        // need the actual text. We piggy-back: the editor stores the same
        // plaintext as a separate sentinel? We don't — so derive plain text by
        // applying the decrypted Y update into a fresh Y.Doc.
        const Y = await import("yjs");
        const { base64ToBytes } = await import("@/lib/yjs/base64");
        const { decryptBytes } = await import("@/lib/crypto");
        const decrypted = await decryptBytes(cryptoKey, base64ToBytes(data.ydoc_state));
        const tmp = new Y.Doc();
        Y.applyUpdate(tmp, decrypted);
        setText(tmp.getText("content").toString());
        tmp.destroy();
      } catch (e) {
        console.error(e);
        setError("Decryption failed.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, searchParams]);

  const head = (
    <Helmet>
      <title>{`Raw markdown: /${slug}.md — Syrin Notes`}</title>
      <meta name="description" content={`View plain markdown (plaintext) of note /${slug} on Syrin Notes — no rendering, no UI.`} />
      <link rel="canonical" href={`https://snote.lovable.app/${slug}.md`} />
      {/* eslint-disable-next-line no-restricted-syntax -- SEO control value */}
      <meta name="robots" content="noindex, follow" />
      <meta property="og:title" content={`Raw markdown: /${slug}.md — Syrin Notes`} />
      <meta property="og:description" content={`Plaintext markdown of note /${slug} on Syrin Notes.`} />
      <meta property="og:url" content={`https://snote.lovable.app/${slug}.md`} />
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
