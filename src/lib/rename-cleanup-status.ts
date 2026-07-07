import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { isDocCached } from "@/lib/yjs/doc-cache";
import { isProviderSlugAbandoned } from "@/lib/yjs/provider";

const OldSlugRowSnapshotSchema = z
  .object({
    slug: z.string(),
    char_count: z.number().nullable(),
    updated_at: z.string().nullable(),
    ydoc_state_len: z.number(),
    content_len: z.number(),
  })
  .nullable();

const OldSlugCleanupSignalsPartialSchema = z
  .object({
    providerAbandoned: z.boolean().optional(),
    docCacheWarm: z.boolean().optional(),
    sessionSnapshotPresent: z.boolean().optional(),
    indexedDbCleared: z.boolean().optional(),
    cleanupStartedAt: z.number().nullable().optional(),
    indexedDbClearedAt: z.number().nullable().optional(),
    snapshotsClearedAt: z.number().nullable().optional(),
  })
  .passthrough();

export const OldSlugCleanupStatusSchema = z.object({
  slug: z.string(),
  source: z.enum(["edge-function", "direct-db-fallback"]),
  database: z.object({
    rowPresent: z.boolean(),
    row: OldSlugRowSnapshotSchema,
  }),
  clientSignals: OldSlugCleanupSignalsPartialSchema,
  cleaned: z.boolean(),
});

export type OldSlugRowSnapshot = {
  slug: string;
  char_count: number | null;
  updated_at: string | null;
  ydoc_state_len: number;
  content_len: number;
} | null;

export type OldSlugCleanupSignals = {
  providerAbandoned: boolean;
  docCacheWarm: boolean;
  sessionSnapshotPresent: boolean;
  indexedDbCleared: boolean;
  cleanupStartedAt: number | null;
  indexedDbClearedAt: number | null;
  snapshotsClearedAt: number | null;
};

export type OldSlugCleanupStatus = {
  slug: string;
  source: "edge-function" | "direct-db-fallback";
  database: {
    rowPresent: boolean;
    row: OldSlugRowSnapshot;
  };
  clientSignals: Partial<OldSlugCleanupSignals>;
  cleaned: boolean;
};

export const CLEANUP_SIGNAL_STORAGE_PREFIX = "syrin:slug-cleanup:";

function readCleanupSignal(slug: string): Partial<OldSlugCleanupSignals> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(`${CLEANUP_SIGNAL_STORAGE_PREFIX}${slug}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<OldSlugCleanupSignals>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function recordOldSlugCleanupSignal(
  slug: string,
  patch: Partial<OldSlugCleanupSignals>,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const current = readCleanupSignal(slug);
    localStorage.setItem(
      `${CLEANUP_SIGNAL_STORAGE_PREFIX}${slug}`,
      JSON.stringify({ ...current, ...patch }),
    );
  } catch {
    /* storage unavailable */
  }
}

export function getLocalOldSlugCleanupSignals(slug: string): OldSlugCleanupSignals {
  const persisted = readCleanupSignal(slug);
  let sessionSnapshotPresent = false;
  try {
    sessionSnapshotPresent = typeof sessionStorage !== "undefined" && !!sessionStorage.getItem(`note-snapshot:${slug}`);
  } catch {
    sessionSnapshotPresent = false;
  }

  return {
    providerAbandoned: isProviderSlugAbandoned(slug),
    docCacheWarm: isDocCached(slug),
    sessionSnapshotPresent,
    indexedDbCleared: !!persisted.indexedDbClearedAt,
    cleanupStartedAt: persisted.cleanupStartedAt ?? null,
    indexedDbClearedAt: persisted.indexedDbClearedAt ?? null,
    snapshotsClearedAt: persisted.snapshotsClearedAt ?? null,
  };
}

function rowSnapshot(row: { slug: string; char_count: number | null; updated_at?: string | null; ydoc_state?: string | null; content?: string | null } | null): OldSlugRowSnapshot {
  if (!row) return null;
  return {
    slug: row.slug,
    char_count: row.char_count ?? null,
    updated_at: row.updated_at ?? null,
    ydoc_state_len: (row.ydoc_state ?? "").length,
    content_len: (row.content ?? "").length,
  };
}

async function directDbStatus(slug: string, clientSignals: OldSlugCleanupSignals): Promise<OldSlugCleanupStatus> {
  const { data, error } = await supabase
    .from("notes")
    .select("slug, char_count, updated_at, ydoc_state, content")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  const row = rowSnapshot(data);
  return {
    slug,
    source: "direct-db-fallback",
    database: { rowPresent: !!row, row },
    clientSignals,
    cleaned: !row && clientSignals.providerAbandoned && !clientSignals.docCacheWarm && !clientSignals.sessionSnapshotPresent,
  };
}

export async function fetchOldSlugCleanupStatus(slug: string): Promise<OldSlugCleanupStatus> {
  const clientSignals = getLocalOldSlugCleanupSignals(slug);
  const { data, error } = await supabase.functions.invoke("old-slug-cleanup-status", {
    body: { slug, clientSignals },
  });
  if (!error && data) return data as OldSlugCleanupStatus;
  return directDbStatus(slug, clientSignals);
}