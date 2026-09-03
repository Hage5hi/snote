# ADR-001: Home mints capabilities before SQL 240

- Status: Accepted (not a production go)
- Date: 2026-09-04
- Deciders: Aegis (architecture); Atlas (go); Syringa (named production steps)
- Evidence cut: `Hage5hi/snote` `main` `931430c0` (PR #89). Live origin `27da93eb`, Worker `9fcc58bc` / `b4d1a94e`. SQL 220+270 applied; 240 not applied. `writes_enabled=true`, `private_realtime_enabled=false`. Soak started 2026-09-02 ~12:01 ICT from `c5914c8e`; not complete as of 2026-09-04 03:15 ICT.

## Context

Production dual-mode canary has `capabilityRoutesEnabled=true`, but Home does not call `POST note-session` `{action:"create"}`. Plain `/<slug>` remains the legacy write path: `anon` RLS on `public.notes` (`NOT capability_managed`), public Realtime `note:${slug}`, `ydoc_state` upsert. `CutoverNotePage` is unmounted. `capability_note_import_legacy` (SQL 240) is absent.

SQL 240 is irreversible: rollback never restores `notes` GRANT/policies. Kill switch is `capability_runtime_set(false, false)` → Edge 503. Tiny plan has no PITR (daily snapshot, ~24h worst-case loss). Staging `snote-g3c-staging` is inactive.

A 2026-09-01 snapshot had 61 notes / 0 `capability_managed`. Soak currently measures dual-mode SPA, not capability create/sync/outbox traffic.

## Decision

When the mint path is built (GitHub first; production only on a named go):

1. Home persists an owner-candidate capability, then `POST note-session` `{action:"create", slug}`, then navigates `/<slug>#owner=<token>`.
2. Do **not** apply SQL 240 until that path exists, soak has capability-write evidence, and Syringa names 240.
3. Trust/identity (“quen/lạ”) stays a local label and must not become a write gate.

This ADR does **not** authorize origin, Worker, Edge, SQL 240, `private_realtime_enabled`, or Home mint in production.

## Alternatives

| Option | What | Why not (now) |
|---|---|---|
| A. SQL 240 first | Revoke anon `notes` access while Home still upserts the table | Closes the only live create/write path. Import-legacy RPC is what 240 adds; CutoverNotePage is unmounted. Tiny has no PITR. |
| B. Stay dual-mode indefinitely | Canary SPA + legacy table forever | Slug remains a write credential. Additive 220/270 never become the authz model. |
| C. Staging + PITR, then 240, mint later | Prove cutover on a clone first | Staging is inactive. Still leaves production Home unable to create after 240. Mint remains a prerequisite for a usable post-cutover product, whether done before or on a clone. |
| D. Private Realtime before mint | Flip `private_realtime_enabled` + auth canary | `NotePage` currently **rejects** `syncTransport !== "polling"`. New client contract, Turnstile/anonymous JWT. Orthogonal to “can anyone create a capability note from Home”. |
| **E. Mint before 240 (this)** | Home create → fragment owner → polling sync | Gives soak a real capability write path without the irreversible revoke. Second-device and share remain capability-scoped, not accounts. |

## Tradeoffs

- Product: creating a note stops being “type a slug”. Owner token lives in the URL fragment (not sent to origin). Losing the fragment without a stored owner capability is lockout — rotation of owner is intentionally not exposed.
- Security: mint does not close legacy slug writes. Until 240, both paths coexist. Encryption pin on the table stays attacker-writable on the legacy path.
- Ops: Tiny still has no PITR. Mint is reversible (don’t have to apply 240). 240 is not.
- Soak: without mint, 48h dual-mode does not prove `note-session`/`note-sync`/outbox. With mint, soak can use synthetic or real capability notes; still need CF-Connecting-IP anti-spoof before opening public create (currently unattested; staging inactive).
- Privacy: Worker `invocation_logs` are **committed** in #89 but **not live**. Next named `syrin-prerender` deploy can log raw URLs including `#`-less locators. Do not couple mint ship to that Worker deploy.

## Consequences

- Forge implements Home create against existing `note-session` contract (`createCapabilityApi().createNote`). No new Edge function.
- Failures stay existing codes: `slug_unavailable` 409, admission 429/503, missing HMAC 503.
- `legacyOnly` dual-mode remains until 240. Home existence check today is `select slug, char_count from notes` — after mint, capability-managed rows are invisible to that query; Home must not treat “not in notes” as “slug free” once create can 409 from the RPC.
- SQL 240, private Realtime, quen/lạ overlay, and Worker log deploy stay separately named.

## Open questions (do not guess)

1. CF-Connecting-IP anti-spoof on the public create path.
2. Whether `share-view` is SHA-pinned; `LEGACY_SHARE_CUTOFF` set.
3. Current `capability_managed` count (do not reuse 61/0).
4. Pre-240 snapshot recency on Tiny.
