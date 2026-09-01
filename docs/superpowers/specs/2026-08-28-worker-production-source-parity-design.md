# Worker production source parity design

**Live status (2026-09-02):** Production Worker `syrin-prerender` is PR #52
`9fcc58bc` / Cloudflare Version ID `b4d1a94e-b391-4682-841a-10dca111b1d6`,
not `8382c5bb`. This document records the G4 repository-reconciliation
design. See `docs/security-findings.md` §1c.

## Goal

Make the Cloudflare Worker source and non-secret production configuration in
`main` match the Worker already verified and deployed during G4. This is a
repository-reconciliation change only: it must not deploy, change routes, alter
DNS, mutate Supabase, publish the SPA, or use Lovable credits.

## Current drift

At G4, production ran the reviewed Worker source from commit `8382c5bb` with the
sanitized Pages origin `snote-g4-origin.pages.dev`, all three public host routes,
and observability disabled. Then-current `main` contained an older Worker and a
configuration that still named the Lovable origin and enabled top-level
observability. A future deploy from `main` could therefore regress the proven
containment boundary.

PR #10 is not a safe integration path: it is a large, conflicting historical
stack. Only the already deployed Worker concern will be reconstructed on a
fresh branch from current `main`.

## Scope

The change will:

1. Replace `cloudflare-worker/worker.js` with the exact reviewed source from
   `8382c5bb`.
2. Update `cloudflare-worker/wrangler.toml` to describe the current non-secret
   production state: `snote-g4-origin.pages.dev`, the canonical/apex/www
   routes, disabled `workers.dev` and preview URLs, and disabled observability,
   invocation logs, and traces.
3. Bring over the two Worker behavior suites that protect crawler/share
   containment, origin handling, analytics denial, canonical authority, PWA
   asset compatibility, method restrictions, and staging isolation.
4. Update the Worker README only where needed to describe the reconciled source
   and explicit deployment checkpoint.

The change will not import the historical staging framework, PWA release
harness, generated artifacts, evidence bundles, unrelated docs, migrations,
Edge Functions, frontend changes, or any other PR #10 file.

## Source and configuration invariants

- `worker.js` must be byte-identical to the tracked file at `8382c5bb` before
  any intentional compatibility adjustment. No cleanup or refactor is bundled.
- The committed Wrangler configuration contains no secret values. Existing
  secret bindings remain provider-managed and are not read, exported, or
  changed.
- The configuration must retain exactly these routes:
  `note.syrin.online/*`, `syrin.online/*`, and `www.syrin.online/*`.
- `ORIGIN_HOST` must be `snote-g4-origin.pages.dev`; `SITE_URL` must be
  `https://note.syrin.online`.
- `workers_dev`, preview URLs, observability, invocation logs, and traces remain
  disabled.
- No command in this change may run `wrangler deploy`, modify Cloudflare, or
  contact Lovable for code generation.

## Verification

Implementation will use a fresh worktree from the design branch. Before source
changes, a focused parity test must fail against the old `main` Worker/config.
After the minimal transplant, verification must include:

- Worker containment suites;
- the new source/config parity contract;
- lint and all repository typechecks relevant to the touched files;
- dependency audit and full unit coverage;
- production build and bundle-size gate;
- a read-only independent correctness/security review;
- `git diff --check` and a secret-pattern scan of the diff.

The PR will remain repository-only. Passing checks mean the repository can
reproduce the already deployed Worker; they do not authorize a new deployment.

## Delivery

Open one focused PR from current `main`. Its description will record the
deployed source identity, explain that cloud state is unchanged, and link the
G4 evidence boundary. The stale PR #10 and its branch are not merged, rebased,
closed, or deleted as part of this change.
