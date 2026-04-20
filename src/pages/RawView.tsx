import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { deriveKey, decryptString, verifyCheck } from "@/lib/crypto";

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
  // Route is `/:slugMd` where slugMd = "abc.md"; strip the suffix.
  const slugMd = params.slugMd ?? "";
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
        setError("Slug không hợp lệ.");
        return;
      }
      const { data, error: dbError } = await supabase
        .from("notes")
        .select("content, ydoc_state, is_encrypted, enc_salt, enc_check")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (dbError) {
        setError(dbError.message);
        return;
      }
      if (!data) {
        setError(`Note /${slug} không tồn tại.`);
        return;
      }
      if (!data.is_encrypted) {
        setText(data.content ?? "");
        return;
      }
      // Encrypted: pull key from URL hash (#key) or ?key=
      const hashKey = window.location.hash.startsWith("#")
        ? decodeURIComponent(window.location.hash.slice(1))
        : "";
      const key = hashKey || searchParams.get("key") || "";
      if (!key) {
        setError("Note này được mã hoá. Thêm `#<khoá>` vào URL để xem.");
        return;
      }
      if (!data.enc_salt || !data.enc_check || !data.ydoc_state) {
        setError("Thiếu metadata mã hoá.");
        return;
      }
      try {
        const cryptoKey = await deriveKey(key, data.enc_salt);
        const ok = await verifyCheck(cryptoKey, data.enc_check);
        if (!ok) {
          setError("Khoá không đúng.");
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
        setError("Giải mã thất bại.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, searchParams]);

  if (error) {
    return (
      <pre className="raw-pre">{`# ${error}`}</pre>
    );
  }
  if (text === null) {
    return <pre className="raw-pre"># loading…</pre>;
  }
  return <pre className="raw-pre">{text}</pre>;
}
