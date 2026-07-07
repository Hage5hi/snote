// Shared cleanup helper for rename E2E specs. Truncates any rows for the
// given slugs before and after each test so a resurrected/leftover row
// from a prior run can never masquerade as a real regression.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (needed for rename cleanup).`);
  return v;
}

let _c: SupabaseClient | null = null;
function client() {
  if (!_c) _c = createClient(env("VITE_SUPABASE_URL"), env("VITE_SUPABASE_PUBLISHABLE_KEY"));
  return _c;
}

/** Delete all rows for the given slugs. Safe to call repeatedly. */
export async function purgeSlugs(slugs: readonly string[]): Promise<void> {
  const unique = Array.from(new Set(slugs.filter(Boolean)));
  if (unique.length === 0) return;
  await client().from("notes").delete().in("slug", unique);
}

/**
 * Wrap a rename-test body with before/after DB purges for the given slugs.
 * Guarantees the test starts from a clean slate and leaves no rows behind
 * even when the body throws.
 */
export async function withRenameSlugSandbox<T>(
  slugs: readonly string[],
  body: () => Promise<T>,
): Promise<T> {
  await purgeSlugs(slugs);
  try {
    return await body();
  } finally {
    await purgeSlugs(slugs).catch(() => {});
  }
}
