# G3 staging plan — preparation only (not executed)

Status: DRAFT for owner approval. G2 closed at `f712a99c` on 2026-08-22;
the overall release remains NO-GO until G3 and later gates complete.
Nothing in this plan has been executed. No production data, credentials,
or infrastructure has been touched while writing it.

## 1. Objective and scope

Prove the candidate (`f712a99c` line) against an isolated environment with
synthetic data, per `HANDOFF/NEXT_ACTIONS.md` G3 and the rollout tracker's
staging gate: additive migrations in order, capability Edge functions,
Worker containment through a real non-redirecting staging origin, the full
probe matrix, and a rollback rehearsal — ending in a signed evidence
bundle tied to exact SHAs.

Out of scope for G3: the atomic cutover migration
(`20260724000000_atomic_capability_cutover.sql` — never applied as an
ordinary migration; its staging rehearsal belongs to the G6 window with
its own approval), any production mutation, any Lovable/production
reconfiguration, and merging PR #10.

## 2. Inventory of what exists today

| Item | Current state | Source |
|---|---|---|
| Staging environment | None exists; no recorded non-redirecting staging origin | handoff evidence + 2026-08-22 probes |
| Production SPA | `note.syrin.online` via Lovable; `snote.lovable.app` redirects to it | rollout manifest NO-GO notes |
| Production database | Supabase managed through Lovable; owner has no separate Supabase console access | ACCESS_AND_SECRETS |
| Cloudflare | Owner signed in; `wrangler.staging.toml` references `syrin-prerender-staging.thongdocnganhang1.workers.dev` as `EDGE_SERVE_ORIGIN` — whether that worker exists today is unverified | repo + handoff |
| Candidate | PR #10 draft at `f712a99c`, full matrix green | 2026-08-22 CI |
| Secrets in repo | None; `.env.example` lists client vars only | repo |

## 3. Staging environment options and recommendation

| Option | What it gives | Blockers / unknowns | Verdict |
|---|---|---|---|
| A. Lovable preview/Remix environment | Fastest SPA hosting; owner already uses Lovable | UNVERIFIED whether the preview gets an isolated database and Edge functions or shares the production project. If it shares production Supabase it is disqualified outright | Only after isolation is proven in writing; treat as unknown, not assumed |
| B. Separate free-tier Supabase project + Cloudflare hosting for the SPA + staging Worker on `*.workers.dev` | True isolation; synthetic-only data; matches the handoff's "separate free project" allowance once evaluated | Requires creating a Supabase account (owner decision); free projects pause after ~1 week idle (reactivation friction, $0 cost) | **Recommended for the remote staging gate** |
| C. Local Supabase CLI (Docker) on the working machine | Full migration-order rehearsal, Edge function contract runs, probe-script development — zero accounts, zero cost, fully offline | Cannot prove `*.workers.dev` edge behavior, real headers, or Realtime at scale; not evidence for the remote gate | **Recommended as the first, ZCode-autonomous layer** |

Sequencing: C first (build and dry-run everything locally), then B for the
evidence-producing run. A is investigated in parallel only if the owner
wants to reuse Lovable; it must not be chosen on assumption.

## 4. Proposed staging URLs, backend, and data

- SPA hosting: a free Cloudflare Pages project (e.g.
  `snote-staging.pages.dev`) or Workers static assets
  (`snote-staging-spa.<account>.workers.dev`). No domain purchase; no
  custom DNS.
- Containment Worker: `syrin-prerender-staging.<account>.workers.dev`
  (route = that hostname; `ORIGIN_HOST` = the staging SPA host). The
  `.invalid` placeholders are replaced only here, only in staging
  artifacts — the repo's fail-closed files stay untouched.
- Backend: the dedicated free Supabase project; region chosen by latency
  to the owner (suggest Singapore).
- Synthetic data: a deterministic seed script creates every fixture class
  through the APIs under test — plain notes, encrypted notes, an
  oversized-update quarantine fixture, duplicate/replay updates, a
  revoked-view-capability note, and legacy-row fixtures for
  `legacy-note-open`. The production PostgreSQL backup stays excluded
  from staging forever.

## 5. Migration and deploy order (staging)

Baseline: a fresh project records the same ledger; order matters.

1. Apply legacy/base migrations through `20260427041811_*` (fresh schema).
2. `20260522000000_admin_rate_limit.sql`.
3. `20260719000000_security_immediate_containment.sql` — then prove the
   admin RPCs are service-role-only and schedule/verify
   `admin_security_prune()` runs.
4. `20260722000000_capability_backend.sql`.
5. `20260723000000_capability_checkpoint_compaction.sql`.
6. `20260727000000_capability_sync_conflict_codes.sql`.
7. Deploy Edge functions with staging secrets: `admin-session`,
   `admin-list`, `admin-delete`, `admin-rotate` (public routes disabled
   until the gateway X-Forwarded-For proof passes); tombstoned `cleanup`,
   `note-meta`, `share-create`, `share-rename`,
   `old-slug-cleanup-status`; then `note-session`, `note-sync`,
   `note-manage`, `share-view`, `legacy-note-open`.
8. Build the SPA with the staging client env (`VITE_SUPABASE_*` of the
   staging project; `VITE_LEGACY_SHARE_CUTOFF` empty) and deploy to the
   staging host.
9. Deploy the staging Worker with the real staging origin and route;
   verify root/static availability before routing probes.

Staging secrets (all freshly generated, never reused from production,
never transmitted through chat/logs): `CAPABILITY_HMAC_SECRET` (≥32 random
bytes), `ADMIN_PASSPHRASE` (12–72 UTF-8 bytes), `ADMIN_RATE_LIMIT_HMAC_SECRET`
(≥32 random bytes, different from the passphrase),
`ADMIN_SESSION_TTL_MINUTES` (5–30), `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` of the staging project. Turnstile stays
disabled for staging (capability admission uses anonymous auth).

## 6. Probe matrix (must all pass on the exact SHA)

Capability: owner/edit/view isolation; update replay/idempotency;
encrypted update round-trip; outbox reconnect after forced disconnect;
view-capability rotate/revoke; oversized-update quarantine (read-only,
never truncated); checkpoint compaction CAS; conflict codes.
Admin: login, limiter behavior, session revocation — gated on the
Supabase gateway proof that client-supplied `X-Forwarded-For` is
overwritten with exactly one IP literal; if unproven, admin endpoints
stay disabled and return 503 by design.
Edge/Worker: crawler responses generic + `no-store`/`noindex`;
`/~api/analytics` and `/~flock.js` denied through the edge; private
routes never leak slug/token/path; sanitized logs only.
Legacy: `legacy-note-open` exact-match read; share compatibility paths
per the manifest.
Rollback rehearsal: staging checkpoint → restore → re-run the core probe
subset → record the result.

## 7. Rollback per layer

SPA: redeploy previous build. Edge functions: redeploy previous version
per function. Database: staging-only restore from the pre-probe
checkpoint (additive chain is forward-only by design). Worker: previous
`wrangler` deploy of the staging worker. Secrets: rotate back or
regenerate (staging-only impact). The atomic cutover migration is not
part of any G3 step, so its rollback scenario cannot arise here.

## 8. GO/NO-GO criteria for closing G3

A signed evidence bundle containing: exact candidate SHA + bundle
timestamp; the applied migration ledger; probe results (including the
failure-path and rollback rehearsal results); captured edge headers; the
admin-gateway proof outcome; and a redaction scan showing no slug,
token, raw IP, or note content anywhere in the bundle. Independent owner
review of the bundle is the final G3 checkpoint.

## 9. Costs and accounts (all explicit)

| Item | Cost | Who must act |
|---|---|---|
| Supabase free project | $0 (pauses after ~1 week idle) | OWNER: create account + project (or authorize using an existing personal account) |
| Cloudflare Pages / `workers.dev` | $0 on the existing account | OWNER: console access or a scoped wrangler token for deploys |
| Lovable (only if Option A is pursued) | existing plan; verify preview/Remix billing | OWNER: verify + decide |
| Domain | none — `*.pages.dev` / `*.workers.dev` only | — |
| Human time | ~30–60 min of owner console/secret steps; ZCode executes the rest | split below |

## 10. Checkpoint split

ZCode-autonomous (no approval needed): local Supabase CLI rehearsal;
seed/probe/evidence scripts; redaction scanner; this plan's updates;
running all repo gates. Needs explicit owner approval: creating any
account (Supabase), any Cloudflare console action or token issuance,
generating and pasting secret values (via a secure channel, never chat),
choosing Option A/B hosting, every remote deploy, and the final G3 GO.

## 11. Privacy guardrails (hard)

No production data in staging, ever. Probes use synthetic slugs only.
Capability material stays in URL fragments / Bearer headers. Evidence
capture redacts slug/token/raw IP/content before anything is written to
the bundle, and a final automated scan re-checks the bundle before it is
shared. No probe ever emits a write request toward production hosts.
