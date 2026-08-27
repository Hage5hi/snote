# Reserved slug contract design

**Date:** 2026-08-28
**Base:** `main@47c6cc0024e78c7bfa72734a527025f8df79b2b3`
**Scope:** frontend validation only; no database, Edge, Worker, deployment, or
feature-flag change

## Problem

The router owns the case-insensitive single-segment names `note`, `privacy`,
and `s`, while several frontend validators still accept them as note slugs.
This can navigate a user to the wrong route, construct an unusable capability
URL, accept an invalid capability session, or begin a legacy duplicate flow
that the Edge backend will reject. The Edge helper already rejects these names.

## Decision

Add one small frontend module, `src/lib/slug.ts`, containing the existing
character/length rule, the three reserved names, and `isUsableSlug(value)`.
Reserved-name matching is case-insensitive. Replace only the duplicated
frontend regular-expression checks that decide whether a note slug is usable:

- Home availability checking and navigation;
- command-palette note creation;
- capability URL parsing/building;
- capability session response validation;
- legacy duplicate/recovery validation; and
- LegacyNotePage source/target validation.

Keep the HTML `pattern` attribute on the duplicate input for native character
and length validation. JavaScript remains authoritative for reserved names,
because the current simple pattern should not be expanded into a complex
negative-lookahead expression.

The Edge module remains unchanged. A small contract test compares the frontend
and Edge reserved-name lists so the two environments cannot drift silently.

## Alternatives considered

1. **Frontend helper plus parity test — selected.** It removes six duplicate
   regex definitions while leaving Deno/Edge packaging untouched.
2. **One cross-runtime module imported by both Vite and Deno.** This removes the
   duplicated three-item list but adds path, extension, and toolchain coupling
   for almost no practical benefit.
3. **Inline reserved-name checks at every call site.** This has the smallest
   initial diff but preserves the inconsistency that caused the bug.

## Behavior and error handling

- `note`, `privacy`, `s`, and case variants are invalid note slugs.
- Existing valid slugs and existing character/length restrictions are
  unchanged.
- Home and the command palette show their existing invalid-slug state and do
  not navigate or query availability for a reserved name.
- Capability URL parsing returns `null`; URL construction throws the existing
  `invalid slug` error.
- A capability session containing a reserved slug is rejected as an invalid
  response.
- Legacy duplication rejects before reading/writing recovery state or calling
  the capability API.
- No new user-facing string, telemetry, persistence format, or network request
  is introduced.

## Test strategy

Follow RED-GREEN TDD with table-driven cases:

1. Add focused helper tests for valid, malformed, overlength, and mixed-case
   reserved values, including parity with the Edge reserved list.
2. Extend existing Home, capability URL/client, legacy cutover, and
   LegacyNotePage tests at their public behavior boundaries.
3. Add one focused command-palette behavior test only if the existing suite
   cannot express reserved-name rejection without broad setup.
4. Run the targeted tests, lint, app/tooling typechecks, Edge typecheck, full
   coverage suite, and production build/bundle gate.

Tests should prove the failure occurs before navigation, persistence, or API
calls. They should not duplicate every helper case at every UI call site.

## Rollout and non-goals

This is a code-only pull request. Capability routes remain governed by the
existing build flag, and production remains unchanged until a separate reviewed
release. This change does not modify router paths, migrate old notes, rename
existing data, change the capability backend, reconcile the Cloudflare Worker,
or deploy Lovable/Supabase/Cloudflare resources.
