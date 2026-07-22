import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.104.1";
import {
  type CapabilityScope,
  hashCapabilityToken,
  signRealtimeJwt,
} from "./capability.ts";

export const capabilityCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-legacy-share",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CapabilityRpcResponse = {
  status: string;
  session?: unknown;
  acknowledgements?: unknown;
  [key: string]: unknown;
};

type CapabilityDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      note_shares: {
        Row: { token: string; slug: string; created_at: string };
        Insert: { token: string; slug: string; created_at?: string };
        Update: { token?: string; slug?: string; created_at?: string };
        Relationships: [];
      };
      notes: {
        Row: {
          slug: string;
          capability_managed: boolean;
          content: string;
          ydoc_state: string;
          is_encrypted: boolean;
          enc_salt: string | null;
          enc_check: string | null;
          enc_iterations: number;
          updated_at: string;
        };
        Insert: { slug: string };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      capability_note_create: {
        Args: {
          p_slug: string;
          p_owner_token_hash: string;
          p_edit_token_hash: string;
          p_view_token_hash: string;
        };
        Returns: CapabilityRpcResponse;
      };
      capability_session_open: {
        Args: { p_token_hash: string; p_after_seq?: number; p_limit?: number };
        Returns: CapabilityRpcResponse;
      };
      capability_updates_append: {
        Args: {
          p_token_hash: string;
          p_updates: Array<{ updateId: string; payload: string }>;
          p_expected_encryption_version: number;
        };
        Returns: CapabilityRpcResponse;
      };
      capability_note_manage: {
        Args: { p_token_hash: string; p_action: string; p_params?: Record<string, unknown> };
        Returns: CapabilityRpcResponse;
      };
      capability_checkpoint_append: {
        Args: {
          p_token_hash: string;
          p_checkpoint: { checkpointId: string; payload: string; throughSequence: number };
          p_expected_checkpoint_version: number;
          p_expected_encryption_version: number;
        };
        Returns: CapabilityRpcResponse;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export function capabilityJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...capabilityCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Vary": "Authorization, X-Legacy-Share",
    },
  });
}

export function capabilityEnvironment():
  | { ok: false }
  | {
    ok: true;
    supabaseUrl: string;
    hmacSecret: string;
    jwtSecret: string;
    client: SupabaseClient<CapabilityDatabase>;
  } {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const hmacSecret = Deno.env.get("CAPABILITY_HMAC_SECRET") ?? "";
  const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET") ?? "";
  if (
    !supabaseUrl
    || !serviceRoleKey
    || new TextEncoder().encode(hmacSecret).byteLength < 32
    || new TextEncoder().encode(jwtSecret).byteLength < 32
  ) return { ok: false };

  return {
    ok: true,
    supabaseUrl,
    hmacSecret,
    jwtSecret,
    client: createClient<CapabilityDatabase>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

export async function capabilityTokenHash(
  token: string,
  hmacSecret: string,
): Promise<string | null> {
  try {
    return await hashCapabilityToken(token, hmacSecret);
  } catch {
    return null;
  }
}

type StoredSession = {
  capabilityId: string;
  noteId: string;
  slug: string;
  scope: CapabilityScope;
  generation: number;
  syncStatus: "active" | "read_only_quarantine";
  currentSequence: number;
  payloadLimitBytes: number;
  checkpointSequence: number;
  checkpointVersion: number | null;
  checkpointPayload: string | null;
  checkpointEncryptionVersion: number | null;
  missingUpdates: Array<{
    updateId: string;
    payload: string;
    sequence: number;
    encryptionVersion: number;
  }>;
  encryption: {
    enabled: boolean;
    version: number;
    salt: string | null;
    check: string | null;
    iterations: number;
  };
};

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredSession>;
  return typeof candidate.capabilityId === "string"
    && typeof candidate.noteId === "string"
    && typeof candidate.slug === "string"
    && ["owner", "edit", "view"].includes(candidate.scope ?? "")
    && Number.isSafeInteger(candidate.generation)
    && typeof candidate.syncStatus === "string"
    && Array.isArray(candidate.missingUpdates)
    && !!candidate.encryption
    && typeof candidate.encryption === "object";
}

export async function materializeNoteSession(
  stored: unknown,
  supabaseUrl: string,
  jwtSecret: string,
): Promise<Record<string, unknown> | null> {
  if (!isStoredSession(stored)) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  try {
    const realtimeToken = await signRealtimeJwt({
      capabilityId: stored.capabilityId,
      noteId: stored.noteId,
      scope: stored.scope,
      generation: stored.generation,
      issuer: `${supabaseUrl.replace(/\/$/, "")}/auth/v1`,
      secret: jwtSecret,
      nowSeconds,
    });
    return {
      noteId: stored.noteId,
      slug: stored.slug,
      scope: stored.scope,
      realtimeToken,
      realtimeExpiresAt: new Date((nowSeconds + 300) * 1000).toISOString(),
      realtimeTopic: `note:${stored.noteId}`,
      syncStatus: stored.syncStatus,
      currentSequence: stored.currentSequence,
      payloadLimitBytes: stored.payloadLimitBytes,
      checkpointSequence: stored.checkpointSequence,
      checkpointVersion: stored.checkpointVersion,
      checkpointPayload: stored.checkpointPayload,
      checkpointEncryptionVersion: stored.checkpointEncryptionVersion,
      missingUpdates: stored.missingUpdates,
      encryption: stored.encryption,
    };
  } catch {
    return null;
  }
}

export function rpcStatus(value: unknown): string {
  if (!value || typeof value !== "object") return "unavailable";
  return typeof (value as { status?: unknown }).status === "string"
    ? (value as { status: string }).status
    : "unavailable";
}

export function capabilityFailure(status: string): Response {
  if (status === "unauthorized") return capabilityJson({ error: "unauthorized" }, 401);
  if (status === "read_only") return capabilityJson({ error: "read only" }, 409);
  if (status === "version_conflict") return capabilityJson({ error: "version conflict" }, 409);
  if (status === "slug_unavailable") return capabilityJson({ error: "slug unavailable" }, 409);
  if (status === "invalid" || status === "payload_too_large") {
    return capabilityJson({ error: "invalid request" }, 400);
  }
  return capabilityJson({ error: "temporarily unavailable" }, 503);
}
