# Capability route canary design

## Goal

Prepare the ordinary note route for a future, explicitly enabled capability
polling canary while preserving the current production behavior by default.
This change is frontend-only preparation: it does not activate capability
routes, deploy anything, or alter backend permissions.

## Chosen approach

Add one build-time flag, `VITE_CAPABILITY_ROUTES_ENABLED`, with strict opt-in
semantics.

- Only the exact string `"true"` enables the canary path. Missing, empty, or
  any other value means disabled.
- `App.tsx` passes `legacyOnly={!capabilityRoutesEnabled}` to the ordinary
  `NotePage` route and to both `/s` and `/s/:token` `SharePage` routes.
- `SplitView` remains explicitly legacy-only.
- When the flag is disabled, routing and note behavior remain identical to the
  current legacy-only route baseline.
- When the flag is enabled, a valid `#owner=<token>` or `#edit=<token>`
  capability that matches the route locator may open a capability session and
  use the existing capability provider only when the server selects polling.
  A valid `/s#view=<token>` fragment may open a view session through
  `note-session` using the existing fail-closed slug/scope/view-on-`/s` rules.
- A URL without a valid matching capability continues to use the legacy
  provider and legacy metadata path.

No new provider, abstraction, dependency, or backend endpoint is introduced.
The emitted `version.json` records the effective boolean as
`capabilityRoutesEnabled`, because the same source SHA can be built with either
flag value.

## Legacy containment invariant

Route opt-in must not weaken the protections applied to legacy notes. In
`NotePage`, derive one explicit condition:

```ts
const legacyContainment = legacyOnly || !capabilityAccess;
```

Use that condition for the three existing containment decisions:

- reading the legacy encryption secret;
- producing a sanitized legacy share URL;
- disabling encryption-state transitions.

Provider selection remains unchanged: a plain legacy URL constructs the legacy
provider, while a capability URL cannot construct any provider until its
session opens successfully. The session-open path additionally rejects any
transport other than `polling`. Therefore enabling the route flag alone grants
no capability, does not change plain-slug behavior, and cannot activate
Realtime.

## Files in scope

- `src/App.tsx`: parse the exact opt-in flag and wire the ordinary note route
  and both share routes.
- `src/pages/NotePage.tsx`: key legacy containment to actual capability access,
  not only to the route-level compatibility switch.
- `src/pages/SharePage.tsx`: skip `parseCapabilityLocation` and `note-session`
  when `legacyOnly`, matching NotePage.
- `src/vite-env.d.ts`: declare the flag.
- `.env.example`: document a safe default of `false`.
- `vite.config.ts`: attest the effective flag value in `version.json`.
- Existing focused route and `NotePage` tests: prove the boundary below.

## Test contract

Implementation follows RED-GREEN TDD and must prove all of the following:

1. With the flag absent or not exactly `"true"`, the ordinary note route and
   both share routes stay `legacyOnly`; `SplitView` also stays legacy-only.
   SharePage must not parse `/s#view` fragments or call `note-session`.
2. With the flag enabled but no valid matching capability, the page continues
   to read legacy metadata, constructs the legacy provider, sanitizes the share
   URL, and keeps encryption transitions disabled.
3. With a valid matching owner or edit capability, the page opens the existing
   capability session, skips the legacy table metadata path, constructs the
   existing capability provider, and keeps its transport in polling mode.
4. Missing, malformed, or unsupported fragments remain on the legacy path.
5. A syntactically valid capability whose opened session returns a different
   slug or scope fails closed with no provider and no legacy fallback.
6. A session that unexpectedly selects `private-realtime` fails closed before a
   provider is constructed.
7. `version.json` attests the exact effective flag value for both ordinary and
   strict release builds.

Tests must not contact production services and must not enable authentication,
Turnstile, Realtime, or writes.

## Error handling and safety

- Flag parsing fails closed.
- Capability parsing and session-open failures retain the existing fail-closed
  page behavior; this change does not add a fallback that could silently grant
  access.
- An unexpected non-polling session is treated as a session-open failure.
- No token, note content, slug, or IP address is logged.
- The implementation does not mutate Supabase, Cloudflare, or Lovable state.
- `writes_enabled` and `private_realtime_enabled` remain disabled.
- Because the existing owner/edit provider is writable, no public artifact may
  enable this route flag while `writes_enabled` remains false. This PR only
  prepares and tests the route; a later write activation requires separate
  approval and rollback evidence.

## Rollout boundary

This work is a stacked draft PR based on `chore/release-identity`. It may be
pushed for review, but it must not be merged, deployed, or enabled in a
production build as part of this task.

Future activation, if separately approved, must use an exact-SHA release
artifact whose `version.json` also attests `capabilityRoutesEnabled: true`, plus
deterministic canary/rollback gates and a separately approved write path. The
owner has waived fixed 48-hour and 72-hour waiting periods; no time-based soak
is introduced here.

## Non-goals

- No Home-page create, recovery, import, or capability-minting flow.
- No changes to `RawView`. Legacy `/s/:token` rewrite and expired-cutoff
  behavior stay. `/s#view` is gated by the same canary as NotePage; it is not
  dual-mode while the flag is off.
- No Auth, Turnstile, Realtime, `share-view`, Edge Function, database, RLS, or
  migration changes.
- No `20260724000000_atomic_capability_cutover.sql` execution.
- No production publish, Lovable prompt, or Lovable credit usage.
