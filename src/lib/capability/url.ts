export const CAPABILITY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export type CapabilityScope = "owner" | "edit" | "view";

export type CapabilityAccess = {
  slug: string | null;
  scope: CapabilityScope;
  token: string;
};

const NOTE_SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const CANONICAL_ORIGIN = "https://note.syrin.online";

function fragmentParams(hash: string): URLSearchParams | null {
  if (!hash.startsWith("#") || !hash.includes("=")) return null;
  try {
    return new URLSearchParams(hash.slice(1));
  } catch {
    return null;
  }
}

export function parseCapabilityLocation(location: Pick<URL, "pathname" | "search" | "hash">): CapabilityAccess | null {
  const search = new URLSearchParams(location.search);
  if (["owner", "edit", "view"].some((key) => search.has(key))) return null;

  const params = fragmentParams(location.hash);
  if (!params) return null;
  const present = (["owner", "edit", "view"] as const).filter((scope) => params.has(scope));
  if (present.length !== 1) return null;
  const scope = present[0];
  const token = params.get(scope) ?? "";
  if (!CAPABILITY_TOKEN_RE.test(token)) return null;

  if (scope === "view") {
    return location.pathname === "/s" ? { slug: null, scope, token } : null;
  }

  const segments = location.pathname.split("/").filter(Boolean);
  if (segments.length !== 1 || !NOTE_SLUG_RE.test(segments[0]) || segments[0] === "s") return null;
  return { slug: segments[0], scope, token };
}

export function readEncryptionSecret(hash: string): string {
  if (!hash.startsWith("#") || hash.length === 1) return "";
  const params = fragmentParams(hash);
  if (params && (["owner", "edit", "view"] as const).some((scope) => params.has(scope))) {
    return params.get("key") ?? "";
  }
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return "";
  }
}

export function writeEncryptionSecretToHash(currentHash: string, secret: string): string {
  const params = fragmentParams(currentHash);
  if (params && (["owner", "edit", "view"] as const).some((scope) => params.has(scope))) {
    params.set("key", secret);
    return `#${params.toString()}`;
  }
  return `#${encodeURIComponent(secret)}`;
}

export function buildCapabilityUrl(
  scope: CapabilityScope,
  token: string,
  slug?: string,
  encryptionSecret?: string,
): string {
  if (!CAPABILITY_TOKEN_RE.test(token)) throw new Error("invalid capability");
  if (scope !== "view" && (!slug || !NOTE_SLUG_RE.test(slug))) throw new Error("invalid slug");
  const params = new URLSearchParams({ [scope]: token });
  if (encryptionSecret) params.set("key", encryptionSecret);
  const path = scope === "view" ? "/s" : `/${slug}`;
  return `${CANONICAL_ORIGIN}${path}#${params.toString()}`;
}

/** A current page is shareable for collaboration only when it holds edit scope. */
export function buildCurrentEditShareUrl(
  access: CapabilityAccess,
  slug: string,
  encryptionSecret?: string,
): string | null {
  if (access.scope !== "edit" || access.slug !== slug) return null;
  return buildCapabilityUrl("edit", access.token, slug, encryptionSecret);
}

export function replaceCapabilitySlug(access: CapabilityAccess, slug: string): string {
  return buildCapabilityUrl(access.scope, access.token, slug, readEncryptionSecret(window.location.hash));
}
