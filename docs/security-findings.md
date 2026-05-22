# Security findings — Lovable scan triage

This document tracks how each finding from the Lovable security scan
(`https://syrin.online/9bqc0ycw`) maps to the actual code in this repo
and why. It exists so future scans don't keep raising the same
intentional design choices.

> Update this file whenever a new finding lands or the underlying code
> moves. The Lovable scanner is generic and doesn't know Syrin's threat
> model — "anonymous CRUD on `notes` keyed by slug" is the product, not
> a bug.

## 1. note-meta endpoint auth — **fixed**

**Finding:** *"note-meta endpoint auth is optional and silently disabled"*

**Status:** real issue, **fixed**.

The previous implementation guarded the `x-meta-secret` check behind
`if (expected)`. If `NOTE_META_SECRET` was unset in the function's
environment, the endpoint accepted requests without any auth at all.
Combined with the function reading note `content` (including non-empty
plaintext for unencrypted notes), this meant a misconfigured deploy
silently exposed a server-side scrape endpoint.

Fix: `supabase/functions/note-meta/index.ts` now fails closed — if
`NOTE_META_SECRET` is unset and `NOTE_META_ALLOW_INSECURE` is not
explicitly `"1"`, the endpoint returns HTTP 503. The Cloudflare Worker
already sends the header (`cloudflare-worker/worker.js`), so production
behaviour is unchanged. Local dev can opt out by setting
`NOTE_META_ALLOW_INSECURE=1` in `supabase/functions/.env.local` —
**never** set this in production.

The comparison also moved to `constantTimeEqual` so the secret cannot be
recovered via timing.

## 2. Admin endpoints brute-force protection — **fixed**

**Finding:** *"Admin endpoints have no brute-force protection"*

**Status:** real issue, **fixed**.

The four passphrase-gated functions
(`admin-list`, `admin-delete`, `admin-rotate`, `cleanup`) previously
called `verifyPass` (bcrypt or env-fallback) with no per-IP throttle.
An attacker who learned an endpoint URL could grind the hash without
limit; bcrypt cost-10 only buys ~100ms per attempt on modern CPUs.

Fix:
- New migration `20260522000000_admin_rate_limit.sql` creates
  `public.admin_auth_attempts (ip pk, failure_count, first_failure_at,
  locked_until)` with RLS enabled + restrictive deny-all so only the
  service role can read/write it.
- New helper `supabase/functions/_shared/admin-rate-limit.ts` exports
  `getClientIp`, `checkAdminLockout`, `recordAdminAuthAttempt`, and
  `lockoutResponse` (HTTP 429 + `Retry-After`).
- Each function calls `checkAdminLockout(ip)` before `verifyPass` and
  `recordAdminAuthAttempt(ip, ok)` after, with policy:
  - 15-minute sliding window for failure counting.
  - 10 failures inside the window → 30-minute lockout.
  - A single correct passphrase clears the row (success unlocks the IP).

IP extraction prefers `x-forwarded-for` (leftmost), falling back to
`cf-connecting-ip` and `x-real-ip`.

### Operational note

`admin_auth_attempts` accumulates one row per offending IP until the
lock expires. Operators can prune historical rows with:
```sql
DELETE FROM public.admin_auth_attempts
 WHERE COALESCE(locked_until, first_failure_at) < now() - INTERVAL '7 days';
```
(There's an index on `locked_until` to keep that fast.)

## 3. *"Share tokens are fully unprotected with no RLS policies"* — **false positive**

**Status:** intentional. Do not "fix" by adding permissive policies.

`public.note_shares` is the lookup `token → slug` for read-only share
links (`/s/:token`). The migration that creates it intentionally enables
RLS and **adds no policies**, which means default-deny for both `anon`
and `authenticated`. Access happens exclusively through the
`share-create` / `share-view` / `share-revoke` / `share-rename` edge
functions, which use `SUPABASE_SERVICE_ROLE_KEY` and bypass RLS.

See `supabase/migrations/20260427041711_*.sql` lines 28–31:
```
ALTER TABLE public.note_shares ENABLE ROW LEVEL SECURITY;
-- No policies. Deny-by-default. Access only via share-* Edge functions
-- using SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
```

The whole *point* of the table is that the viewer never learns the
slug; if we added a permissive RLS policy to satisfy a scanner, we'd
break that property.

## 4. *"RLS Policy Always True"* on `public.notes` — **false positive (by design)**

**Status:** intentional product behaviour.

Syrin Notes is "instant notes by URL". Visit `syrin.online/<slug>` and
anyone with the URL can read or edit. The slug *is* the access token.
Three policies on `notes` use `USING (true)` to allow `anon` + `authenticated`
SELECT/INSERT/UPDATE, see
`supabase/migrations/20260419225907_*.sql` lines 50–62.

This is documented in the README:
> **Instant notes by URL** — visit `syrin.online/my-note` to create or open a note

If notes ever become user-owned, this needs to change. Until then,
hardening this is a product change, not a security fix.

## 5. *"Any anonymous user can delete any note"* — **false positive (by design)**

Same threat model as §4. The migration that introduced
"Anyone can delete notes" (`20260420041258_*.sql`) is intentional;
delete-on-empty cleanup runs from the `cleanup` edge function (now
rate-limited) and the admin panel's `admin-delete` (now rate-limited).

If a non-empty note disappears it's "someone with the slug deleted it",
which is the same trust level as "someone with the slug overwrote it".

## 6. *"Any anonymous user can overwrite any note"* — **false positive (by design)**

Same threat model as §4 and §5. Overwriting via the Yjs CRDT (clients
broadcast `Y.update` binary on a Supabase Realtime channel `note:<slug>`)
is the entire collaboration model. Encrypted notes additionally require
the URL hash key to decrypt, so an overwriter without the key can only
trash the document — they cannot read it.

## 7. *"RLS Enabled No Policy"* (info) — **false positive (by design)**

This is the same as §3 plus `public.admin_config` and (now)
`public.admin_auth_attempts`. All three are service-role-only tables;
they all have RLS enabled with explicit restrictive deny-all policies
and no permissive policies, which is the correct shape for that role
boundary.

---

## How to re-run the scan

When Lovable re-runs the scan, items 3–7 should still appear because
they reflect product design. Use this document to triage them quickly
and reject pull requests that try to "fix" them by adding permissive
RLS policies on `note_shares`, `admin_config`, or `admin_auth_attempts`.
