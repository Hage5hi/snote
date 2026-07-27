# Lovable-Managed Realtime Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the undeployable custom Realtime JWT signer with capability-partitioned Lovable anonymous Auth, private Realtime membership, and a durable polling fallback without weakening Snote's capability or encryption model.

**Architecture:** The capability remains the only note authority and stays in `Authorization`; a separate capability-partitioned anonymous Auth JWT travels in `X-Snote-Auth` only to establish a short-lived private Realtime identity. Database membership and runtime-control rows are the source of truth, while the client uses private Realtime only for platform JWTs whose verified lifetime is at most 300 seconds and otherwise falls back to idempotent API polling over the existing IndexedDB outbox.

**Tech Stack:** Bun 1.3.14, TypeScript 5.9, React 18, Supabase JS 2.104.1, Lovable Cloud Auth/Edge Functions/Postgres/Realtime, Yjs 13, IndexedDB, Cloudflare Turnstile, Vitest 3.2, PGlite 0.5, Playwright 1.60, GitHub Actions.

---

## Scope and invariants

Implement against baseline `17819f9ca3aa313d5042b6f908c70da1c0205931` in the existing isolated worktree and branch `local/realtime-auth-redesign`. The approved design is `docs/superpowers/specs/2026-07-24-lovable-managed-realtime-auth-design.md`.

The following invariants apply to every task:

- `Authorization: Bearer <capability>` remains the HTTP authority.
- `X-Snote-Auth: <platform JWT>` is optional, bounded to 8,192 characters, never reflected, and never logged.
- No browser code uses `src/integrations/supabase/client.ts` for anonymous Auth.
- Missing, malformed, invalid, non-anonymous, or long-lived Auth JWTs select polling and never public Realtime.
- Auth infrastructure failures return `503`; they do not create memberships.
- Private Realtime is disabled in the database by default.
- Capability writes are disabled in the database by default and enabled only by an explicit control-plane call.
- Every local Yjs update is in IndexedDB before its first network attempt and is deleted only after server acknowledgement.
- No production mutation occurs before the Remix staging gate, independent review, recoverable backup evidence, and the 48-hour soak.

## File responsibility map

### New focused files

- `src/lib/capability/turnstile.ts` — load and explicitly render one Turnstile challenge; return one single-use CAPTCHA token.
- `src/lib/capability/auth.ts` — derive capability-safe Auth partitions and obtain/reuse a Lovable anonymous Auth access token.
- `src/lib/capability/__tests__/turnstile.test.ts` — challenge lifecycle, expiry, failure, and cleanup.
- `src/lib/capability/__tests__/auth.test.ts` — partition, lock, session reuse/refresh, and fail-closed behavior.
- `src/lib/yjs/capability-polling.ts` — deterministic polling timer/backoff/event controller.
- `src/lib/yjs/__tests__/capability-polling.test.ts` — visible/hidden cadence, jitter, backoff, coalescing, and teardown.
- `supabase/functions/_shared/capability-auth.ts` — pure Auth-header and verified-claim assessment.
- `scripts/__tests__/capability-realtime-auth.test.ts` — Edge Auth and source-contract tests.
- `supabase/functions/anonymous-auth-cleanup/index.ts` — bounded membership and abandoned anonymous-user cleanup.
- `supabase/functions/anonymous-auth-cleanup/index.test.ts` — cleanup filtering, bounded deletion, and aggregate-only output.
- `scripts/verify-realtime-auth-soak.ts` — fail-closed verifier for the continuous 48-hour evidence bundle.
- `scripts/__tests__/verify-realtime-auth-soak.test.ts` — valid and invalid soak evidence.
- `scripts/__tests__/realtime-auth-rollout-contract.test.ts` — immutable deployment order and production-exclusion contract.
- `playwright.staging.config.ts` — remote-only, secret-safe Remix test configuration.
- `e2e-staging/fixtures/remix.ts` — synthetic fixture lifecycle with identifier-free diagnostics.
- `e2e-staging/realtime-auth.spec.ts` — Turnstile, identity partition, private/polling, refresh, and revoke tests.
- `e2e-staging/durable-sync.spec.ts` — navigation, offline/reopen, and acknowledgement-order durability.
- `e2e-staging/encryption-gate.spec.ts` — locked split-view plaintext gate.
- `.github/workflows/lovable-remix-staging.yml` — manual protected staging verification at an immutable SHA.
- `docs/security/lovable-realtime-auth-rollout.md` — operator runbook and evidence schema.

### Existing files changed in place

- `src/lib/capability/client.ts` and its tests — discriminated `NoteSession` plus separated capability/Auth headers.
- `src/lib/yjs/capability-provider.ts`, provider tests, and `src/lib/yjs/provider.ts` — transport reconciliation, private refresh order, polling fallback, and transport diagnostics.
- `src/hooks/use-sync-status.ts`, `src/components/note/SyncIndicator.tsx`, their tests, and locale dictionaries — expose secure polling without identifiers.
- `supabase/functions/_shared/capability.ts` — remove the custom JWT signer.
- `supabase/functions/_shared/capability-edge.ts` — verified platform Auth and session materialization.
- `supabase/functions/note-session/index.ts`, `note-sync/index.ts`, `note-manage/index.ts`, and `share-view/index.ts` — validate Auth and return the selected transport.
- `supabase/migrations/20260722000000_capability_backend.sql`, `20260723000000_capability_checkpoint_compaction.sql`, and `20260724000000_atomic_capability_cutover.sql` — runtime controls, membership, RLS, and write fences.
- `supabase/config.toml` and `src/integrations/supabase/types.ts` — cleanup function configuration and generated database contract.
- Security, capability, staging, and release documentation listed in Task 12.

Do not modify `src/integrations/supabase/client.ts` or the IndexedDB schema in `src/lib/yjs/capability-outbox.ts`.

### Task 1: Turnstile and capability-partitioned anonymous Auth

**Files:**
- Create: `src/lib/capability/turnstile.ts`
- Create: `src/lib/capability/auth.ts`
- Create: `src/lib/capability/__tests__/turnstile.test.ts`
- Create: `src/lib/capability/__tests__/auth.test.ts`
- Modify: `src/vite-env.d.ts`

- [ ] **Step 1: Write failing Turnstile lifecycle tests**

Test explicit script loading once, one widget per request, success resolution, expired/error/timeout resolution to `null`, and removal of the temporary host. Use an injected `windowLike`, `documentLike`, and 290-second timeout so the test never touches the network.

```ts
it("returns a single-use token and removes the challenge host", async () => {
  const harness = turnstileHarness();
  const source = createTurnstileTokenSource({
    siteKey: "1x00000000000000000000AA",
    windowLike: harness.window,
    documentLike: harness.document,
  });
  const pending = source.token();
  harness.callbacks.callback("captcha-token");
  await expect(pending).resolves.toBe("captcha-token");
  expect(harness.removedHosts).toBe(1);
});

it.each(["error-callback", "expired-callback", "timeout-callback"] as const)(
  "%s fails closed",
  async (callbackName) => {
    const harness = turnstileHarness();
    const source = createTurnstileTokenSource({
      siteKey: "1x00000000000000000000AA",
      windowLike: harness.window,
      documentLike: harness.document,
    });
    const pending = source.token();
    harness.callbacks[callbackName]();
    await expect(pending).resolves.toBeNull();
  },
);
```

- [ ] **Step 2: Run the Turnstile test and confirm RED**

Run:

```powershell
bun run test -- src/lib/capability/__tests__/turnstile.test.ts
```

Expected: FAIL because `../turnstile` does not exist.

- [ ] **Step 3: Implement the explicit Turnstile source**

Export this stable interface and constants:

```ts
export interface TurnstileTokenSource {
  token(): Promise<string | null>;
}

export type TurnstileSourceOptions = {
  siteKey: string;
  windowLike?: Window;
  documentLike?: Document;
  timeoutMs?: number;
};

const SCRIPT_ID = "snote-turnstile-api";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 290_000;
```

`createTurnstileTokenSource()` must:

1. Return `null` when `siteKey`, DOM, or `window.turnstile` loading is unavailable.
2. Reuse a single script promise identified by `SCRIPT_ID`.
3. Append a temporary fixed-position host with `role="dialog"` and accessible label `Security verification`.
4. Call `turnstile.render(host, { sitekey, execution: "execute", appearance: "interaction-only", callback, "error-callback", "expired-callback", "timeout-callback" })`.
5. Call `turnstile.execute(widgetId)`.
6. Settle exactly once, call `turnstile.remove(widgetId)`, remove the host, and clear the timeout.
7. Never print the token or Turnstile error object.

Add the minimal local `Window` augmentation in the same file, not the global generated Supabase client.

- [ ] **Step 4: Write failing Auth partition tests**

Use injected crypto, storage, lock manager, Turnstile source, clock, and Supabase-client factory. Pin these behaviors:

```ts
it("derives a deterministic partition without the raw capability", async () => {
  const capability = "A".repeat(43);
  const first = await capabilityAuthStorageKey(capability);
  const second = await capabilityAuthStorageKey(capability);
  expect(first).toBe(second);
  expect(first).toMatch(/^snote-auth-v1-[a-f0-9]{64}$/);
  expect(first).not.toContain(capability);
});

it("coalesces concurrent anonymous signup under the digest lock", async () => {
  const harness = authHarness();
  const source = createCapabilityAuthSource(harness.options);
  await expect(Promise.all([
    source.accessTokenFor(harness.capability),
    source.accessTokenFor(harness.capability),
  ])).resolves.toEqual(["access-a", "access-a"]);
  expect(harness.signInAnonymously).toHaveBeenCalledTimes(1);
  expect(harness.turnstileToken).toHaveBeenCalledTimes(1);
});

it("cached-only never signs in or refreshes", async () => {
  const harness = authHarness({ session: null });
  const source = createCapabilityAuthSource(harness.options);
  await expect(
    source.accessTokenFor(harness.capability, "cached-only"),
  ).resolves.toBeNull();
  expect(harness.signInAnonymously).not.toHaveBeenCalled();
  expect(harness.refreshSession).not.toHaveBeenCalled();
});
```

Also test distinct capabilities, persisted-session reuse, refresh inside 90 seconds of expiry, invalid refresh-token partition cleanup and CAPTCHA-backed recreation, disabled feature, storage denial, missing Web Locks, and no secret in thrown errors.

- [ ] **Step 5: Run the Auth test and confirm RED**

Run:

```powershell
bun run test -- src/lib/capability/__tests__/auth.test.ts
```

Expected: FAIL because `../auth` does not exist.

- [ ] **Step 6: Implement the Auth source**

Use these exact public types:

```ts
export type CapabilityAuthMode = "ensure" | "cached-only";

export interface CapabilityAuthSource {
  accessTokenFor(
    capability: string,
    mode?: CapabilityAuthMode,
  ): Promise<string | null>;
}

export type CapabilityAuthOptions = {
  supabaseUrl: string;
  publishableKey: string;
  enabled: boolean;
  turnstile: TurnstileTokenSource;
  storage?: Storage;
  lockManager?: LockManager;
  now?: () => number;
  createAuthClient?: (
    url: string,
    key: string,
    storageKey: string,
    storage: Storage,
  ) => Pick<SupabaseClient, "auth">;
};
```

Implement `capabilityAuthStorageKey()` as SHA-256 over UTF-8 bytes of the exact concatenation `snote-auth-v1${capability}` and return `snote-auth-v1-${hexDigest}`. Validate with `CAPABILITY_TOKEN_RE` before hashing.

The default client factory must use:

```ts
createClient(url, key, {
  auth: {
    storage,
    storageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
```

Cache clients by digest. For `ensure`, read `auth.getSession()`, refresh only when `expires_at * 1000 - now() <= 90_000`, and return a nonempty access token. If no usable session exists, require `navigator.locks`; acquire `snote-auth-lock-${digest}`, re-read the session in the lock, obtain Turnstile, and call:

```ts
auth.signInAnonymously({
  options: { captchaToken },
});
```

For `cached-only`, return the current unexpired access token without refresh, signup, or Turnstile. When refresh reports an invalid/deleted session, call `auth.signOut({ scope: "local" })` for only that partition and perform one CAPTCHA-backed recreation. Convert storage, lock, Turnstile, Auth, and SDK failures to `null` without logging identifiers.

Export `createDefaultCapabilityAuthSource()` using `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`, and `VITE_CAPABILITY_AUTH_ENABLED === "true"`. Memoize one module-level default source so repeated `createCapabilityApi()` calls share the digest-keyed client cache; never key that cache by the raw token. Add the latter two typed Vite variables to `src/vite-env.d.ts`.

- [ ] **Step 7: Run both unit suites and commit**

Run:

```powershell
bun run test -- src/lib/capability/__tests__/turnstile.test.ts src/lib/capability/__tests__/auth.test.ts
```

Expected: PASS with no network access and no console output containing test tokens.

Commit:

```powershell
git add src/lib/capability/turnstile.ts src/lib/capability/auth.ts src/lib/capability/__tests__/turnstile.test.ts src/lib/capability/__tests__/auth.test.ts src/vite-env.d.ts
git commit -m "feat(auth): partition anonymous sessions by capability"
```

### Task 2: Capability API transport contract

**Files:**
- Modify: `src/lib/capability/client.ts`
- Modify: `src/lib/capability/__tests__/client.test.ts`
- Modify: `src/pages/__tests__/SharePage.capability.test.tsx`

- [ ] **Step 1: Write failing discriminated-session and header tests**

Define fixtures for both modes and assert exact header separation:

```ts
const pollingSession = {
  ...durableSessionFields(),
  syncTransport: "polling" as const,
  realtimeToken: null,
  realtimeExpiresAt: null,
};

const privateSession = {
  ...durableSessionFields(),
  syncTransport: "private-realtime" as const,
  realtimeToken: "platform.jwt.value",
  realtimeExpiresAt: "2026-07-24T12:05:00.000Z",
};

it("separates capability authority from platform Auth", async () => {
  const authSource = {
    accessTokenFor: vi.fn().mockResolvedValue("platform.jwt.value"),
  };
  const fetcher = vi.fn().mockResolvedValue(jsonResponse({ session: pollingSession }));
  await createCapabilityApi({
    baseUrl: "https://project.supabase.co",
    authSource,
    fetcher,
  }).openSession(CAPABILITY);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://project.supabase.co/functions/v1/note-session");
  expect(init.headers).toEqual({
    "Content-Type": "application/json",
    Authorization: `Bearer ${CAPABILITY}`,
    "X-Snote-Auth": "platform.jwt.value",
  });
  expect(init.body).toBe('{"afterSequence":0}');
});
```

Test missing Auth header, keepalive `cached-only`, invalid mixed token/null pairs, exact `realtimeTopic`, all existing checkpoint/encryption fields, per-page token acquisition, and a private first page followed by a polling page resulting in a polling aggregate.

- [ ] **Step 2: Run the client tests and confirm RED**

Run:

```powershell
bun run test -- src/lib/capability/__tests__/client.test.ts src/pages/__tests__/SharePage.capability.test.tsx
```

Expected: FAIL because `syncTransport`, nullable fields, and `authSource` are unsupported.

- [ ] **Step 3: Implement the session union**

Replace the current session type with:

```ts
export type NoteSessionBase = {
  noteId: string;
  slug: string;
  scope: CapabilityScope;
  realtimeTopic: `note:${string}`;
  generation: number;
  syncStatus: "active" | "read_only_quarantine";
  currentSequence: number;
  payloadLimitBytes: number;
  checkpointSequence: number;
  checkpointVersion: number | null;
  checkpointPayload: string | null;
  checkpointEncryptionVersion: number | null;
  missingUpdates: NoteUpdate[];
  encryption: EncryptionMetadata;
};

export type PrivateRealtimeNoteSession = NoteSessionBase & {
  syncTransport: "private-realtime";
  realtimeToken: string;
  realtimeExpiresAt: string;
};

export type PollingNoteSession = NoteSessionBase & {
  syncTransport: "polling";
  realtimeToken: null;
  realtimeExpiresAt: null;
};

export type NoteSession =
  | PrivateRealtimeNoteSession
  | PollingNoteSession;
```

Keep every existing structural, sequence, payload-size, hash, checkpoint, and encryption validation. Add a branch that accepts exactly one of:

```ts
const validTransport =
  session.syncTransport === "private-realtime"
    ? typeof session.realtimeToken === "string"
      && session.realtimeToken.length > 0
      && session.realtimeToken.length <= 8192
      && typeof session.realtimeExpiresAt === "string"
      && Number.isFinite(Date.parse(session.realtimeExpiresAt))
    : session.syncTransport === "polling"
      && session.realtimeToken === null
      && session.realtimeExpiresAt === null;
```

- [ ] **Step 4: Attach the optional Auth header through one request path**

Extend `ApiOptions` with `authSource?: CapabilityAuthSource`, default it with `createDefaultCapabilityAuthSource()`, and change `post()` to:

```ts
const authToken = token
  ? await authSource.accessTokenFor(
      token,
      keepalive ? "cached-only" : "ensure",
    )
  : null;
const headers: Record<string, string> = {
  "Content-Type": "application/json",
};
if (token) headers.Authorization = `Bearer ${token}`;
if (authToken && authToken.length <= 8192) {
  headers["X-Snote-Auth"] = authToken;
}
```

Keep `cache: "no-store"`, `credentials: "omit"`, capability validation, and JSON-only bodies. In pagination, construct `aggregate = { ...next, missingUpdates: merged }` so a later polling page cannot retain an earlier private token.

- [ ] **Step 5: Update the Share page fixture, rerun, and commit**

Add `syncTransport: "private-realtime"` to the existing Share page session fixture.

Run:

```powershell
bun run test -- src/lib/capability/__tests__/client.test.ts src/pages/__tests__/SharePage.capability.test.tsx
```

Expected: PASS.

Commit:

```powershell
git add src/lib/capability/client.ts src/lib/capability/__tests__/client.test.ts src/pages/__tests__/SharePage.capability.test.tsx
git commit -m "feat(api): attach managed auth to capability requests"
```

### Task 3: Fail-closed database runtime controls

**Files:**
- Modify: `supabase/migrations/20260722000000_capability_backend.sql`
- Modify: `supabase/migrations/20260723000000_capability_checkpoint_compaction.sql`
- Modify: `supabase/migrations/20260724000000_atomic_capability_cutover.sql`
- Modify: `scripts/__tests__/capability-backend-contract.test.ts`
- Modify: `scripts/__tests__/capability-migration.integration.test.ts`
- Modify: `src/lib/legacy/__tests__/migration-contract.test.ts`
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Write failing runtime-control tests**

Add contract assertions that no migration or Edge helper reads `CAPABILITY_WRITE_DISABLED` or `auth.jwt().note_write_disabled`, and PGlite tests that all five mutators return `writes_disabled` while reads continue.

```ts
it.each([
  "capability_note_create",
  "capability_updates_append",
  "capability_note_manage",
  "capability_checkpoint_append",
  "capability_note_import_legacy",
])("%s is fenced by the database runtime row", (functionName) => {
  expect(allCapabilityMigrations).toMatch(
    new RegExp(
      `FUNCTION public\\.${functionName}[\\s\\S]+capability_writes_enabled`,
    ),
  );
});

it("removes custom write claims and environment switches", () => {
  expect(allCapabilitySources).not.toContain("note_write_disabled");
  expect(allCapabilitySources).not.toContain("CAPABILITY_WRITE_DISABLED");
});
```

- [ ] **Step 2: Run focused database tests and confirm RED**

Run:

```powershell
bun run test -- scripts/__tests__/capability-backend-contract.test.ts scripts/__tests__/capability-migration.integration.test.ts src/lib/legacy/__tests__/migration-contract.test.ts
```

Expected: FAIL because runtime rows/RPCs are absent and atomic RLS reads custom JWT claims.

- [ ] **Step 3: Add the runtime table and control-plane RPCs**

Because `20260722000000_capability_backend.sql` has not been deployed, edit it directly. If a target environment already contains that migration version, stop and create `20260724120000_lovable_managed_realtime_auth.sql` with the same forward-only objects instead of changing applied history.

Add:

```sql
CREATE TABLE public.capability_runtime_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  writes_enabled boolean NOT NULL DEFAULT false,
  private_realtime_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.capability_runtime_settings(
  singleton,
  writes_enabled,
  private_realtime_enabled
) VALUES (true, false, false);

ALTER TABLE public.capability_runtime_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.capability_runtime_settings
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.capability_writes_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE((
    SELECT settings.writes_enabled
    FROM public.capability_runtime_settings AS settings
    WHERE settings.singleton
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.capability_runtime_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'writesEnabled', settings.writes_enabled,
        'privateRealtimeEnabled', settings.private_realtime_enabled,
        'updatedAt', settings.updated_at
      )
      FROM public.capability_runtime_settings AS settings
      WHERE settings.singleton
    ),
    jsonb_build_object(
      'writesEnabled', false,
      'privateRealtimeEnabled', false,
      'updatedAt', null
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.capability_runtime_set(
  p_writes_enabled boolean,
  p_private_realtime_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  UPDATE public.capability_runtime_settings
  SET writes_enabled = p_writes_enabled,
      private_realtime_enabled = p_private_realtime_enabled,
      updated_at = now()
  WHERE singleton
  RETURNING jsonb_build_object(
    'writesEnabled', writes_enabled,
    'privateRealtimeEnabled', private_realtime_enabled,
    'updatedAt', updated_at
  ) INTO v_result;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'capability runtime row missing';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.capability_writes_enabled()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_runtime_state()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_runtime_set(boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capability_runtime_state() TO service_role;
GRANT EXECUTE ON FUNCTION public.capability_runtime_set(boolean, boolean)
  TO service_role;
```

- [ ] **Step 4: Fence every mutation at the SQL boundary**

At the beginning of `capability_note_create`, `capability_updates_append`, `capability_note_manage`, `capability_checkpoint_append`, and `capability_note_import_legacy`, add:

```sql
IF NOT public.capability_writes_enabled() THEN
  RETURN jsonb_build_object('status', 'writes_disabled');
END IF;
```

Replace the atomic Realtime INSERT policy's `note_write_disabled` claim with the membership predicate implemented in Task 4. Update legacy rollback tests to require `capability_runtime_set(false, false)` and HTTP `503`, not an environment variable.

- [ ] **Step 5: Update generated types, rerun, and commit**

Add `capability_runtime_state` and `capability_runtime_set` signatures plus the runtime table shape to `src/integrations/supabase/types.ts`.

Run:

```powershell
bun run test -- scripts/__tests__/capability-backend-contract.test.ts scripts/__tests__/capability-migration.integration.test.ts src/lib/legacy/__tests__/migration-contract.test.ts
```

Expected: PASS for runtime controls; membership tests added in Task 4 remain pending because the membership objects have not landed.

Commit:

```powershell
git add supabase/migrations/20260722000000_capability_backend.sql supabase/migrations/20260723000000_capability_checkpoint_compaction.sql supabase/migrations/20260724000000_atomic_capability_cutover.sql scripts/__tests__/capability-backend-contract.test.ts scripts/__tests__/capability-migration.integration.test.ts src/lib/legacy/__tests__/migration-contract.test.ts src/integrations/supabase/types.ts
git commit -m "feat(db): add fail-closed capability runtime controls"
```

### Task 4: Short-lived Realtime membership and RLS

**Files:**
- Modify: `supabase/migrations/20260722000000_capability_backend.sql`
- Modify: `supabase/migrations/20260724000000_atomic_capability_cutover.sql`
- Modify: `scripts/__tests__/capability-migration.integration.test.ts`
- Modify: `scripts/__tests__/capability-backend-contract.test.ts`
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Write failing membership integration tests**

Create minimal `auth.users`, `auth.uid()`, `realtime.messages`, and `realtime.topic()` test fixtures. Use three anonymous UIDs for owner/edit/view and a fourth for note B. Cover bind, cross-note denial, same-UID capability collision, scope, expiry, rotation, pruning, concurrent refresh, runtime flags, and duplicate update idempotency.

```ts
expect(await bind(ownerTokenHash, ownerUserId, secondsFromNow(300)))
  .toMatchObject({ status: "ok" });
expect(await allows(ownerUserId, `note:${noteA}`, true)).toBe(true);
expect(await allows(viewUserId, `note:${noteA}`, false)).toBe(true);
expect(await allows(viewUserId, `note:${noteA}`, true)).toBe(false);
expect(await allows(ownerUserId, `note:${noteB}`, false)).toBe(false);
expect(await bind(editTokenHash, ownerUserId, secondsFromNow(300)))
  .toMatchObject({ status: "identity_conflict" });
```

- [ ] **Step 2: Run the integration test and confirm RED**

Run:

```powershell
bun run test -- scripts/__tests__/capability-migration.integration.test.ts
```

Expected: FAIL because membership, bind/prune/candidate RPCs, and UID/topic RLS do not exist.

- [ ] **Step 3: Add the service-only membership schema**

Add the composite capability key and membership table:

```sql
ALTER TABLE public.note_capabilities
  ADD CONSTRAINT note_capabilities_capability_note_unique
  UNIQUE (capability_id, note_id);

CREATE TABLE public.note_realtime_memberships (
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.notes(note_id) ON DELETE CASCADE,
  capability_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_user_id, note_id),
  UNIQUE (auth_user_id),
  FOREIGN KEY (capability_id, note_id)
    REFERENCES public.note_capabilities(capability_id, note_id)
    ON DELETE CASCADE,
  CHECK (expires_at > refreshed_at),
  CHECK (expires_at <= refreshed_at + interval '5 minutes')
);

ALTER TABLE public.note_realtime_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.note_realtime_memberships
  FROM PUBLIC, anon, authenticated, service_role;
```

- [ ] **Step 4: Add atomic bind, prune, cleanup-candidate, and admission behavior**

Extend `capability_admission_consume` with operation `membership`, per-capability limit 1,000/hour, and global limit 250,000/hour. Implement:

```sql
public.capability_realtime_membership_bind(
  p_token_hash text,
  p_auth_user_id uuid,
  p_expires_at timestamptz
) RETURNS jsonb
```

The function must validate the token hash/UUID/expiry, require an anonymous `auth.users` row, require `private_realtime_enabled`, consume membership admission in the same transaction, select an active unrevoked capability and live capability-managed note, clamp expiry to `LEAST(p_expires_at, now() + interval '5 minutes')`, and run:

```sql
INSERT INTO public.note_realtime_memberships AS existing (
  auth_user_id,
  note_id,
  capability_id,
  expires_at,
  created_at,
  refreshed_at
) VALUES (
  p_auth_user_id,
  v_note_id,
  v_capability_id,
  v_expires_at,
  now(),
  now()
)
ON CONFLICT (auth_user_id, note_id) DO UPDATE
SET expires_at = EXCLUDED.expires_at,
    refreshed_at = EXCLUDED.refreshed_at
WHERE existing.capability_id = EXCLUDED.capability_id
RETURNING auth_user_id INTO v_bound_user;
```

Before the insert, reject any row with the same `auth_user_id` and a different capability or note. Return `identity_conflict` when no safe row is returned; never replace authority.

Add service-only:

```sql
capability_realtime_memberships_prune() RETURNS integer
capability_realtime_cleanup_candidates(p_auth_user_ids uuid[]) RETURNS uuid[]
```

The prune function deletes only expired rows. The candidate function rejects arrays over 500 and returns only input anonymous-user IDs older than the cleanup caller's retention filter that have no unexpired membership. Revoke all three functions from `PUBLIC`, `anon`, and `authenticated`; grant only to `service_role`.

When `capability_note_manage` rotates a capability, delete memberships for the revoked `capability_id` in the same transaction. Note deletion remains cascade-driven.

- [ ] **Step 5: Replace claim-based Realtime authorization**

Use this exact signature:

```sql
CREATE OR REPLACE FUNCTION public.realtime_capability_allows(
  p_auth_user_id uuid,
  p_topic text,
  p_write boolean
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.note_realtime_memberships AS membership
    JOIN public.note_capabilities AS capability
      ON capability.capability_id = membership.capability_id
     AND capability.note_id = membership.note_id
    JOIN public.notes AS note ON note.note_id = membership.note_id
    JOIN public.capability_runtime_settings AS runtime ON runtime.singleton
    WHERE membership.auth_user_id = p_auth_user_id
      AND membership.expires_at > now()
      AND p_topic = 'note:' || membership.note_id::text
      AND capability.revoked_at IS NULL
      AND note.capability_managed
      AND note.deleted_at IS NULL
      AND note.sync_status <> 'deleted'
      AND runtime.private_realtime_enabled
      AND (
        NOT p_write
        OR (
          capability.scope IN ('owner', 'edit')
          AND note.sync_status = 'active'
          AND runtime.writes_enabled
        )
      )
  );
$$;
```

Policies must call only `auth.uid()`, `realtime.topic()`, and this predicate:

```sql
CREATE POLICY "Snote capabilities can receive private messages"
ON realtime.messages FOR SELECT TO authenticated
USING (
  extension IN ('broadcast', 'presence')
  AND public.realtime_capability_allows(
    (SELECT auth.uid()),
    (SELECT realtime.topic()),
    false
  )
);

CREATE POLICY "Snote editors can send private messages"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  extension IN ('broadcast', 'presence')
  AND public.realtime_capability_allows(
    (SELECT auth.uid()),
    (SELECT realtime.topic()),
    true
  )
);
```

Remove all `auth.jwt()` note, scope, generation, and write claims from both additive and atomic migrations.

- [ ] **Step 6: Rerun database tests and commit**

Run:

```powershell
bun run test -- scripts/__tests__/capability-migration.integration.test.ts scripts/__tests__/capability-backend-contract.test.ts
```

Expected: PASS for distinct identities, collision, cross-note denial, scope, expiry, runtime gates, prune, rotation, concurrency, and idempotency.

Commit:

```powershell
git add supabase/migrations/20260722000000_capability_backend.sql supabase/migrations/20260724000000_atomic_capability_cutover.sql scripts/__tests__/capability-migration.integration.test.ts scripts/__tests__/capability-backend-contract.test.ts src/integrations/supabase/types.ts
git commit -m "feat(db): bind managed auth identities to realtime capabilities"
```

### Task 5: Verify Lovable Auth and materialize private or polling sessions

**Files:**
- Create: `supabase/functions/_shared/capability-auth.ts`
- Create: `scripts/__tests__/capability-realtime-auth.test.ts`
- Modify: `supabase/functions/_shared/capability.ts`
- Modify: `supabase/functions/_shared/capability-edge.ts`
- Modify: `supabase/functions/note-session/index.ts`
- Modify: `supabase/functions/note-sync/index.ts`
- Modify: `supabase/functions/note-manage/index.ts`
- Modify: `supabase/functions/share-view/index.ts`
- Modify: `scripts/__tests__/capability-backend-contract.test.ts`
- Modify: `scripts/__tests__/share-view-no-store.test.ts`

- [ ] **Step 1: Write failing pure Auth tests**

Test missing, malformed, overlong, wrong issuer/audience/role, non-anonymous, invalid UUID, future `iat`, expired token, lifetime 301, and valid lifetime 300. The verifier dependency must distinguish invalid credentials from infrastructure failure.

```ts
expect(assessVerifiedClaims(
  "header.payload.signature",
  validClaims({ iat: 1000, exp: 1300 }),
  "https://project.supabase.co/auth/v1",
  1001,
)).toEqual({
  mode: "private-realtime",
  token: "header.payload.signature",
  userId: USER_ID,
  issuedAt: 1000,
  expiresAt: 1300,
});

expect(assessVerifiedClaims(
  "header.payload.signature",
  validClaims({ iat: 1000, exp: 1301 }),
  "https://project.supabase.co/auth/v1",
  1001,
)).toEqual({ mode: "polling" });
```

- [ ] **Step 2: Run the Auth contract suite and confirm RED**

Run:

```powershell
bun run test -- scripts/__tests__/capability-realtime-auth.test.ts
```

Expected: FAIL because `_shared/capability-auth.ts` does not exist.

- [ ] **Step 3: Implement the pure Auth assessment**

Export:

```ts
export const MAX_SNOTE_AUTH_CHARS = 8192;

export type VerifiedRealtimeAuth =
  | { mode: "polling" }
  | {
      mode: "private-realtime";
      token: string;
      userId: string;
      issuedAt: number;
      expiresAt: number;
    }
  | { mode: "unavailable" };

export function readSnoteAuthHeader(req: Request): string | null;

export function assessVerifiedClaims(
  token: string,
  claims: Record<string, unknown>,
  expectedIssuer: string,
  nowSeconds: number,
): Exclude<VerifiedRealtimeAuth, { mode: "unavailable" }>;
```

`readSnoteAuthHeader()` trims `x-snote-auth`, accepts only a three-part JWT no longer than 8,192 characters, and otherwise returns `null`. `assessVerifiedClaims()` returns private mode only for exact issuer `${SUPABASE_URL}/auth/v1`, audience containing `authenticated`, role `authenticated`, `is_anonymous === true`, UUID `sub`, integer `iat/exp`, `iat <= now < exp`, and `0 < exp - iat <= 300`. Every other claim shape returns polling.

- [ ] **Step 4: Remove custom signing and add verified Auth wrapper**

Delete `RealtimeJwtInput`, `signRealtimeJwt`, base64url-signing helpers used only by it, `SUPABASE_JWT_SECRET`, `jwtSecret`, `capabilityWritesDisabled()`, and every custom Realtime claim.

Add `x-snote-auth` to CORS and `X-Snote-Auth` to `Vary`.

Use:

```ts
export async function verifyRealtimeAuth(
  req: Request,
  environment: CapabilityEnvironment,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedRealtimeAuth> {
  const token = readSnoteAuthHeader(req);
  if (!token) return { mode: "polling" };
  try {
    const { data, error } = await environment.client.auth.getUser(token);
    if (error) {
      const status = Number((error as { status?: unknown }).status);
      return status >= 500
        ? { mode: "unavailable" }
        : { mode: "polling" };
    }
    const user = data.user;
    if (!user) return { mode: "polling" };
    const claims = decodeUntrustedJwtPayload(token);
    if (!claims || claims.sub !== user.id || user.is_anonymous !== true) {
      return { mode: "polling" };
    }
    return assessVerifiedClaims(
      token,
      claims,
      `${environment.supabaseUrl.replace(/\/$/, "")}/auth/v1`,
      nowSeconds,
    );
  } catch {
    return { mode: "unavailable" };
  }
}
```

`decodeUntrustedJwtPayload()` is used only after `getUser(token)` succeeds; it never establishes trust by itself and never logs the token.

- [ ] **Step 5: Implement session materialization**

Use:

```ts
export type SessionMaterialization =
  | { status: "ok"; session: Record<string, unknown> }
  | {
      status:
        | "identity_conflict"
        | "unauthorized"
        | "unavailable";
    };

export async function materializeNoteSession(
  stored: unknown,
  tokenHash: string,
  auth: VerifiedRealtimeAuth,
  environment: CapabilityEnvironment,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionMaterialization>;
```

For polling, return all durable fields plus:

```ts
{
  syncTransport: "polling",
  realtimeToken: null,
  realtimeExpiresAt: null,
  realtimeTopic: `note:${stored.noteId}`,
}
```

For private mode, call `capability_realtime_membership_bind` with the token hash, verified user ID, and `new Date(Math.min(auth.expiresAt, nowSeconds + 300) * 1000).toISOString()`. Map bind `polling` to polling materialization, `identity_conflict` to 409, `unauthorized` to 401, and RPC/infrastructure failure to 503. On bind `ok`, return:

```ts
{
  syncTransport: "private-realtime",
  realtimeToken: auth.token,
  realtimeExpiresAt: new Date(
    Math.min(auth.expiresAt, nowSeconds + 300) * 1000,
  ).toISOString(),
  realtimeTopic: `note:${stored.noteId}`,
}
```

Change `capabilityFailure("identity_conflict")` to HTTP 409 and `capabilityFailure("writes_disabled")` to HTTP 503.

- [ ] **Step 6: Wire all four capability endpoints**

For each capability branch:

1. Read and hash the capability.
2. Call `verifyRealtimeAuth(req, environment)`.
3. Return 503 for Auth infrastructure `unavailable` before a mutating RPC.
4. Execute the existing capability RPC.
5. Call `materializeNoteSession(stored, tokenHash, auth, environment)`.
6. Map the materialization union once through a shared response helper.

`share-view` legacy compatibility must not read `X-Snote-Auth` and must never create membership. Capability-only raw clients receive polling. Keep `verify_jwt = false` for capability endpoints because the gateway Authorization header contains the capability, not a platform token.

- [ ] **Step 7: Run Edge/auth/contract tests and commit**

Run:

```powershell
bun run test -- scripts/__tests__/capability-realtime-auth.test.ts scripts/__tests__/capability-backend-contract.test.ts scripts/__tests__/share-view-no-store.test.ts
bun run typecheck:edge
```

Expected: PASS; source search finds no signer, signing secret, or custom Realtime claims.

Commit:

```powershell
git add supabase/functions/_shared/capability-auth.ts supabase/functions/_shared/capability.ts supabase/functions/_shared/capability-edge.ts supabase/functions/note-session/index.ts supabase/functions/note-sync/index.ts supabase/functions/note-manage/index.ts supabase/functions/share-view/index.ts scripts/__tests__/capability-realtime-auth.test.ts scripts/__tests__/capability-backend-contract.test.ts scripts/__tests__/share-view-no-store.test.ts
git commit -m "feat(edge): validate Lovable managed realtime auth"
```

### Task 6: Private Realtime lifecycle

**Files:**
- Modify: `src/lib/yjs/capability-provider.ts`
- Modify: `src/lib/yjs/__tests__/capability-provider.test.ts`

- [ ] **Step 1: Write failing private lifecycle tests**

Pin exact order and both transition directions:

```ts
expect(events).toEqual([
  "open-session",
  "set-auth:platform.jwt.new",
  "subscribe",
]);

expect(realtimeDispose).toHaveBeenCalledTimes(1);
expect(realtimeFactory).not.toHaveBeenCalledWith(
  expect.objectContaining({ syncTransport: "polling" }),
);
```

Test initial `setAuth` completion before subscribe, refresh through `openSession` before `setAuth`, exact returned token, private-to-polling disposal, polling-to-private creation, encryption fencing, and destroy-once behavior.

- [ ] **Step 2: Run provider tests and confirm RED**

Run:

```powershell
bun run test -- src/lib/yjs/__tests__/capability-provider.test.ts
```

Expected: FAIL because the factory is synchronous and token fields are unconditional.

- [ ] **Step 3: Narrow and make the Realtime factory asynchronous**

Change:

```ts
export type CapabilityRealtimeFactory = (
  session: PrivateRealtimeNoteSession,
) => Promise<CapabilityRealtimeHandle>;
```

The default factory must create a separate non-persisted Realtime client, await `client.realtime.setAuth(session.realtimeToken)`, then create the private channel. Remove the static `accessToken` callback. Never create a public channel.

- [ ] **Step 4: Reconcile private transport explicitly**

Extract these methods:

```ts
private async startPrivateRealtime(
  session: PrivateRealtimeNoteSession,
): Promise<void>;
private async stopPrivateRealtime(): Promise<void>;
private async reconcileTransport(
  previous: NoteSession,
  next: NoteSession,
): Promise<void>;
private schedulePrivateRefresh(): void;
```

Refresh order must be:

```text
openSession(capability, currentSequence)
applyDurableSession(next)
reconcileTransport(previous, next)
realtime.setAuth(next.realtimeToken)
schedulePrivateRefresh()
```

Type-narrow before every token access. `setAuth(null)` is forbidden. A transition to polling disposes the channel and clears the private refresh timer. Encryption transitions stop the active transport before the two durable refreshes and restart only the selected returned mode.

- [ ] **Step 5: Run and commit**

Run:

```powershell
bun run test -- src/lib/yjs/__tests__/capability-provider.test.ts
```

Expected: PASS for private lifecycle and transport transitions.

Commit:

```powershell
git add src/lib/yjs/capability-provider.ts src/lib/yjs/__tests__/capability-provider.test.ts
git commit -m "feat(sync): refresh private realtime through managed auth"
```

### Task 7: Durable polling fallback

**Files:**
- Create: `src/lib/yjs/capability-polling.ts`
- Create: `src/lib/yjs/__tests__/capability-polling.test.ts`
- Modify: `src/lib/yjs/capability-provider.ts`
- Modify: `src/lib/yjs/__tests__/capability-provider.test.ts`
- Modify: `src/lib/yjs/__tests__/capability-outbox.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Use fake timers and injected visibility/random. Assert visible interval in `[1700, 2300]`, hidden interval in `[8500, 11500]`, exponential backoff capped at 30,000 ms before jitter, overlapping trigger coalescing, immediate focus/online/visible trigger, and listener/timer teardown.

```ts
expect(nextDelay({ hidden: false, failures: 0, random: () => 0.5 }))
  .toBe(2000);
expect(nextDelay({ hidden: true, failures: 0, random: () => 0.5 }))
  .toBe(10000);
expect(nextDelay({ hidden: false, failures: 8, random: () => 0.5 }))
  .toBe(30000);
```

- [ ] **Step 2: Run scheduler tests and confirm RED**

Run:

```powershell
bun run test -- src/lib/yjs/__tests__/capability-polling.test.ts
```

Expected: FAIL because `../capability-polling` does not exist.

- [ ] **Step 3: Implement the polling controller**

Export:

```ts
export const POLL_VISIBLE_MS = 2_000;
export const POLL_HIDDEN_MS = 10_000;
export const POLL_MAX_BACKOFF_MS = 30_000;
export const POLL_JITTER_RATIO = 0.15;

export type CapabilityPollingControllerOptions = {
  run: () => Promise<void>;
  isHidden: () => boolean;
  random?: () => number;
  setTimer?: typeof window.setTimeout;
  clearTimer?: typeof window.clearTimeout;
  eventTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget?: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;
};
```

`nextDelay()` uses base 2 seconds visible or 10 seconds hidden, doubles for each failure, caps at 30 seconds, and multiplies by `0.85 + random() * 0.30`. The controller exposes `start()`, `trigger()`, `recordSuccess()`, `recordFailure()`, and `stop()`. It coalesces overlapping runs and schedules one follow-up. It listens for `focus`, `online`, and `visibilitychange` to visible.

- [ ] **Step 4: Write failing provider/outbox polling tests**

Test that polling never calls the Realtime factory, view mode only opens sessions, writable mode enqueues before sync, failed sync survives destroy/reopen, only acknowledgements delete rows, focus/online/visible triggers catch-up, 401/409 fences and stops while retaining rows, 429/503 back off, and private peer rescue remains unchanged.

- [ ] **Step 5: Implement provider polling**

Add `polling: CapabilityPollingController | null` and `pollPromise`. `connect()` applies the returned durable session and outbox before selecting one transport.

Implement:

```ts
private async pollNow(): Promise<void> {
  if (this.pollPromise) return this.pollPromise;
  this.pollPromise = (async () => {
    if (this.access.scope !== "view") await this.flushNow(false);
    const previous = this.session;
    const next = await this.api.openSession(
      this.access.token,
      this.session.currentSequence,
    );
    await this.applyDurableSession(next);
    await this.reconcileTransport(previous, next);
  })().finally(() => {
    this.pollPromise = null;
  });
  return this.pollPromise;
}
```

Polling sends no awareness or Yjs broadcast. Existing local update order remains encrypt → hash → IndexedDB enqueue → network attempt. `flushNow()` deletes only IDs present in server acknowledgements. Treat authorization/collision errors as terminal write fence and retain rows; treat rate-limit/unavailable/network errors as transient and retain rows. On destroy, remove polling listeners/timers, wait for pending IndexedDB writes, perform cached-only keepalive flush, then close the outbox.

- [ ] **Step 6: Run polling regressions and commit**

Run:

```powershell
bun run test -- src/lib/yjs/__tests__/capability-polling.test.ts src/lib/yjs/__tests__/capability-provider.test.ts src/lib/yjs/__tests__/capability-outbox.test.ts
```

Expected: PASS, including existing reverse acknowledgement, generation isolation, peer rescue, compaction, and encryption transition tests.

Commit:

```powershell
git add src/lib/yjs/capability-polling.ts src/lib/yjs/capability-provider.ts src/lib/yjs/__tests__/capability-polling.test.ts src/lib/yjs/__tests__/capability-provider.test.ts src/lib/yjs/__tests__/capability-outbox.test.ts
git commit -m "feat(sync): add durable polling fallback"
```

### Task 8: Transport diagnostics and user-visible secure polling

**Files:**
- Modify: `src/lib/yjs/provider.ts`
- Modify: `src/hooks/use-sync-status.ts`
- Modify: `src/hooks/__tests__/use-sync-status.test.ts`
- Modify: `src/components/note/SyncIndicator.tsx`
- Create: `src/components/note/__tests__/SyncIndicator.test.tsx`
- Modify: `src/lib/yjs/capability-provider.ts`
- Modify: locale dictionaries under `src/i18n/locales`

- [ ] **Step 1: Write failing transport-diagnostic tests**

Extend the existing union to:

```ts
export type SyncEvent =
  | { type: "synced-durable" }
  | { type: "recovered"; bytes: number }
  | { type: "conflict"; bytes: number }
  | { type: "error"; message: string }
  | { type: "offline" }
  | { type: "online" }
  | { type: "transport"; mode: "private-realtime" | "polling" };
```

Test that polling reports `transportMode: "polling"`, the indicator announces `Secure polling mode; collaboration may be delayed`, and no note ID, slug, capability, JWT, path, or fragment appears.

- [ ] **Step 2: Run focused UI tests and confirm RED**

Run:

```powershell
bun run test -- src/hooks/__tests__/use-sync-status.test.ts src/components/note/__tests__/SyncIndicator.test.tsx
```

Expected: FAIL because transport events/state/copy do not exist.

- [ ] **Step 3: Implement identifier-free transport state**

Emit `{ type: "transport", mode }` only after transport reconciliation. Add `transportMode` to the sync snapshot without changing the five existing durability statuses. In `SyncIndicator`, keep the existing icon/status and add an accessible suffix and tooltip only for polling. Add the same translation key to all nine locale dictionaries; English fallback text is acceptable only where the repository's existing locale policy marks a dictionary partial.

- [ ] **Step 4: Run i18n and UI tests and commit**

Run:

```powershell
bun run test -- src/hooks/__tests__/use-sync-status.test.ts src/components/note/__tests__/SyncIndicator.test.tsx
bun run i18n:check
```

Expected: PASS with no missing locale key.

Commit:

```powershell
git add src/lib/yjs/provider.ts src/lib/yjs/capability-provider.ts src/hooks/use-sync-status.ts src/hooks/__tests__/use-sync-status.test.ts src/components/note/SyncIndicator.tsx src/components/note/__tests__/SyncIndicator.test.tsx src/i18n/locales
git commit -m "feat(sync): report secure polling transport"
```

### Task 9: Prune memberships and abandoned anonymous users

**Files:**
- Create: `supabase/functions/anonymous-auth-cleanup/index.ts`
- Create: `supabase/functions/anonymous-auth-cleanup/index.test.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write failing cleanup tests**

Inject an admin client and clock. Test expired membership pruning, anonymous-only age filter of 30 days, active-membership exclusion, maximum 500 candidates, collection-before-delete to avoid pagination shifts, bounded deletion, internal authentication, and aggregate-only output.

```ts
expect(result).toEqual({
  membershipsPruned: 4,
  usersScanned: 120,
  anonymousUsersDeleted: 7,
  failures: 0,
});
expect(JSON.stringify(result)).not.toMatch(UUID_RE);
```

- [ ] **Step 2: Run Deno test and confirm RED**

Run:

```powershell
deno test --frozen --allow-env supabase/functions/anonymous-auth-cleanup/index.test.ts
```

Expected: FAIL because the cleanup function does not exist.

- [ ] **Step 3: Implement bounded cleanup**

Accept internal POST only and reject browser CORS. Keep gateway verification enabled: the scheduler invokes the function with the service-role platform token in `Authorization`. In the handler, require `x-snote-cleanup` and compare it in constant time against `ANONYMOUS_AUTH_CLEANUP_SECRET` with at least 32 bytes. Call `capability_realtime_memberships_prune()`, collect up to 500 anonymous users whose `created_at` is older than 30 days using `auth.admin.listUsers`, pass IDs to `capability_realtime_cleanup_candidates`, then call `auth.admin.deleteUser(id)` for at most 100 returned candidates per run. Collect IDs before deletion. Return and log only the four integer counts from the test; never serialize IDs or Auth errors.

Add:

```toml
[functions.anonymous-auth-cleanup]
verify_jwt = true
```

The daily scheduler is configured manually on the Remix first and production only after the cleanup test evidence is accepted.

- [ ] **Step 4: Run and commit**

Run:

```powershell
deno test --frozen --allow-env supabase/functions/anonymous-auth-cleanup/index.test.ts
bun run typecheck:edge
```

Expected: PASS.

Commit:

```powershell
git add supabase/functions/anonymous-auth-cleanup/index.ts supabase/functions/anonymous-auth-cleanup/index.test.ts supabase/config.toml
git commit -m "feat(ops): prune abandoned anonymous auth users"
```

### Task 10: Privacy contracts and soak verifier

**Files:**
- Modify: `scripts/__tests__/application-log-privacy.test.ts`
- Create: `scripts/verify-realtime-auth-soak.ts`
- Create: `scripts/__tests__/verify-realtime-auth-soak.test.ts`
- Create: `scripts/__tests__/realtime-auth-rollout-contract.test.ts`
- Modify: `scripts/__tests__/lovable-skill-contract.test.ts`
- Modify: `scripts/__tests__/verify-capability-cutover.test.ts`
- Modify: `scripts/verify-capability-cutover.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing privacy and rollout contract tests**

Forbid `X-Snote-Auth`, JWT-looking values, capability fragments, raw storage partition values, slugs, content, paths, and raw IPs in application logging. Require deployment order:

```text
containment DB/functions
Cloudflare generic Worker on every alias
note-meta tombstone and cache purge
additive capability/Auth DB
capability Edge APIs
anonymous Auth + Turnstile
immutable SPA publish
48-hour soak
atomic cutover
main fast-forward and branch cleanup
```

The contract must reject atomic migration inclusion in the Remix additive phase.

- [ ] **Step 2: Write soak-verifier tests**

Use a JSON evidence schema with:

```ts
type RealtimeAuthSoakEvidence = {
  startedAt: string;
  endedAt: string;
  immutableGitSha: string;
  buildId: string;
  migrationHashes: Record<string, string>;
  telemetryGapSeconds: number;
  deploymentOrConfigChanges: number;
  backupRestoreProof: boolean;
  jwtLifetimeViolations: number;
  privateSessionsWithoutLogProof: number;
  rawSecretFindings: number;
  crossNoteAuthorizationSuccesses: number;
  strandedOutboxUpdates: number;
  encryptedSyncFailures: number;
  compactionFailures: number;
};
```

Accept only at least 172,800 continuous seconds, identical immutable artifacts, zero telemetry gap, zero changes, backup proof true, and every violation/failure count zero.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```powershell
bun run test -- scripts/__tests__/application-log-privacy.test.ts scripts/__tests__/realtime-auth-rollout-contract.test.ts scripts/__tests__/verify-realtime-auth-soak.test.ts scripts/__tests__/lovable-skill-contract.test.ts scripts/__tests__/verify-capability-cutover.test.ts
```

Expected: FAIL because the verifier and rollout contract do not exist and old cutover assumptions remain.

- [ ] **Step 4: Implement strict verifiers and package scripts**

`verify-realtime-auth-soak.ts` must parse one file path, validate every field, print only `realtime auth soak verified` on success, and exit nonzero with identifier-free field names on failure. Extend cutover verification to require runtime state, anonymous Auth/Turnstile evidence, JWT-lifetime mode, header-log evidence, Worker route/version evidence, and a verified soak record for the exact SHA/build/migration hashes.

Add:

```json
{
  "test:realtime-auth": "vitest run src/lib/capability src/lib/yjs scripts/__tests__/capability-realtime-auth.test.ts scripts/__tests__/capability-migration.integration.test.ts scripts/__tests__/realtime-auth-rollout-contract.test.ts",
  "test:e2e:lovable-remix": "playwright test --config=playwright.staging.config.ts",
  "soak:verify": "bun run scripts/verify-realtime-auth-soak.ts"
}
```

- [ ] **Step 5: Run and commit**

Run:

```powershell
bun run test -- scripts/__tests__/application-log-privacy.test.ts scripts/__tests__/realtime-auth-rollout-contract.test.ts scripts/__tests__/verify-realtime-auth-soak.test.ts scripts/__tests__/lovable-skill-contract.test.ts scripts/__tests__/verify-capability-cutover.test.ts
```

Expected: PASS and incomplete/short evidence exits nonzero.

Commit:

```powershell
git add scripts/__tests__/application-log-privacy.test.ts scripts/verify-realtime-auth-soak.ts scripts/__tests__/verify-realtime-auth-soak.test.ts scripts/__tests__/realtime-auth-rollout-contract.test.ts scripts/__tests__/lovable-skill-contract.test.ts scripts/__tests__/verify-capability-cutover.test.ts scripts/verify-capability-cutover.ts package.json
git commit -m "test(security): enforce realtime auth rollout gates"
```

### Task 11: Secret-safe Lovable Remix browser gate

**Files:**
- Create: `playwright.staging.config.ts`
- Create: `e2e-staging/fixtures/remix.ts`
- Create: `e2e-staging/realtime-auth.spec.ts`
- Create: `e2e-staging/durable-sync.spec.ts`
- Create: `e2e-staging/encryption-gate.spec.ts`
- Create: `.github/workflows/lovable-remix-staging.yml`

- [ ] **Step 1: Write the remote-only Playwright config**

Require `LOVABLE_REMIX_URL`, reject known production hosts including `note.syrin.online`, use Chromium with `retries: 0`, no local `webServer`, and:

```ts
use: {
  baseURL: remixUrl,
  trace: "off",
  video: "off",
  screenshot: "off",
},
reporter: [["line"]],
```

The fixture may report only scenario names, durations, counts, and boolean results.

- [ ] **Step 2: Implement synthetic fixtures and staging scenarios**

Create only synthetic legacy, owner/edit/view, note-B, revoked/rotated, encrypted, oversized/quarantined, and orphan-anonymous-user records. Tests must cover:

- valid/missing/invalid/expired/replayed Turnstile;
- same-capability multi-tab identity reuse;
- owner and view links in one browser profile using distinct identities;
- default/long JWT returning polling with no channel or membership;
- verified 300-second JWT returning private mode only after the log gate;
- reconnect, refresh, and revoke bounded to five minutes;
- typing then navigation in under 800 ms;
- offline/reopen and reversed acknowledgements;
- locked split view never mounting editor or preview plaintext.

Use Cloudflare test keys only for automated challenge cases and a dedicated staging widget for manual approval.

- [ ] **Step 3: Add the protected manual workflow**

Use `workflow_dispatch` inputs `git_sha` and `remix_url`, checkout the exact SHA, install Bun 1.3.14 with frozen lockfile, reject production URLs, build the exact SHA, and run `bun run test:e2e:lovable-remix`. Bind the job to GitHub Environment `lovable-remix`. Do not upload raw Playwright artifacts; upload only a sanitized JSON summary after a contract test confirms it contains no URL, slug, token, UUID, content, path, fragment, or IP.

- [ ] **Step 4: Validate workflow and commit**

Run:

```powershell
bun run test -- scripts/__tests__/realtime-auth-rollout-contract.test.ts
actionlint .github/workflows/lovable-remix-staging.yml
```

Expected: PASS; the workflow is manual, protected, remote-only, zero-retry, immutable-SHA, and production-excluding.

Commit:

```powershell
git add playwright.staging.config.ts e2e-staging .github/workflows/lovable-remix-staging.yml scripts/__tests__/realtime-auth-rollout-contract.test.ts
git commit -m "test(staging): add Lovable remix auth gate"
```

### Task 12: Documentation and release procedure

**Files:**
- Create: `docs/security/lovable-realtime-auth-rollout.md`
- Modify: `docs/capability-backend.md`
- Modify: `docs/capability-client.md`
- Modify: `docs/security/atomic-capability-cutover.md`
- Modify: `docs/security/stacked-rollout-tracker.md`
- Modify: `docs/security/immediate-containment-rollout.md`
- Modify: `docs/security-findings.md`
- Modify: `docs/e2e-env-overrides.md`
- Modify: `lovable-skills/snote-release/SKILL.md`
- Modify: `docs/superpowers/specs/2026-07-24-lovable-managed-realtime-auth-design.md`

- [ ] **Step 1: Update contracts and remove stale custom-JWT guidance**

Document the `NoteSession` union, `Authorization`/`X-Snote-Auth`, Auth partition, membership/RLS, runtime flags, polling cadence, cleanup retention, and no-secret logging. Remove every instruction to set `SUPABASE_JWT_SECRET`, `CAPABILITY_WRITE_DISABLED`, or custom Realtime claims.

- [ ] **Step 2: Write the exact staging and production runbook**

The runbook must require:

1. Restricted Lovable Remix with empty-data proof, region, project ID, immutable SHA/build ID, and migration hashes.
2. Fresh staging-only HMAC/admin/Turnstile/cleanup secrets.
3. Anonymous Auth enabled only on the Remix.
4. Phase A long/default JWT proving polling and zero membership/channel.
5. Phase B 300-second JWT only if Lovable exposes it.
6. `X-Snote-Auth` redaction inspection across Lovable Auth/gateway/Edge and Cloudflare Workers Logs, Tail, Logpush, traces, and HTTP datasets.
7. Additive migrations only; atomic cutover excluded.
8. Dedicated Cloudflare staging Worker hostname/environment; production `wrangler.toml` is forbidden for staging.
9. Synthetic suite and cleanup evidence.
10. Independent review, immutable release candidate, backup/restore checkpoint, and production order from Task 10.
11. A 48-hour clock that restarts after any deployment/configuration change or telemetry gap.
12. Rollback using `capability_runtime_set(false, false)`, HTTP `503` write probes, Realtime RLS denial, unchanged direct-table revocations, preserved outbox, exact Worker version/routes, immutable rollback artifact, and restore reference.

- [ ] **Step 3: Update the approved spec status and release skill contract**

Set the spec status to `Approved by the user on 2026-07-24`, link this plan, and require Remix, Turnstile, JWT lifetime, header redaction, polling, cleanup, 48-hour soak, backup, atomic cutover, and post-cutover probes in `lovable-skills/snote-release/SKILL.md`.

- [ ] **Step 4: Run documentation contracts and commit**

Run:

```powershell
bun run test -- scripts/__tests__/lovable-skill-contract.test.ts scripts/__tests__/realtime-auth-rollout-contract.test.ts scripts/__tests__/capability-backend-contract.test.ts
```

Expected: PASS with no stale signing-secret or custom-claim guidance.

Commit:

```powershell
git add docs/capability-backend.md docs/capability-client.md docs/security/lovable-realtime-auth-rollout.md docs/security/atomic-capability-cutover.md docs/security/stacked-rollout-tracker.md docs/security/immediate-containment-rollout.md docs/security-findings.md docs/e2e-env-overrides.md lovable-skills/snote-release/SKILL.md docs/superpowers/specs/2026-07-24-lovable-managed-realtime-auth-design.md
git commit -m "docs(security): document managed realtime auth rollout"
```

### Task 13: Full local verification and independent review

**Files:**
- Modify only files required by verified failures.

- [ ] **Step 1: Run focused security and sync gates**

```powershell
bun run test:realtime-auth
deno test --frozen --allow-env supabase/functions/anonymous-auth-cleanup/index.test.ts
bun run typecheck:edge
```

Expected: all PASS.

- [ ] **Step 2: Run the repository gate**

```powershell
bun install --frozen-lockfile
bun run lint
bunx tsc --noEmit -p tsconfig.app.json
bun run test:coverage
bun run build:check
bun run knip
git diff --check
git diff --check 17819f9ca3aa313d5042b6f908c70da1c0205931...HEAD
```

Expected: exit 0 for every command, no lockfile change, no lint warning, no type error, no failing/duplicate focused suite, no bundle-budget failure, no unexplained Knip finding, and no whitespace error.

- [ ] **Step 3: Request two-stage code review**

Use the requesting-code-review skill. Review stage one for spec compliance and security invariants; review stage two for implementation quality, test quality, race conditions, cleanup, and operational rollback. Fix every verified high/medium finding test-first and rerun Steps 1–2.

- [ ] **Step 4: Commit verified review fixes**

```powershell
git status --short
git add --all
git commit -m "fix(security): address managed auth review findings"
```

Expected: commit only when review produced code/doc changes; otherwise leave the verified tree clean without an empty commit.

### Task 14: Lovable Remix staging deployment and evidence

**Files:**
- No repository source changes unless a staging test proves a defect.
- Evidence is sanitized and stored outside the repository until its contract test passes.

- [ ] **Step 1: Create and verify the isolated Remix**

Create a restricted Lovable Cloud Remix, select the intended region, and verify zero notes/Auth users/storage objects plus no production domain. Record only Remix ID, region, immutable Git SHA, build ID, migration hashes, and boolean empty-data proof.

- [ ] **Step 2: Configure staging security controls**

Provision fresh staging-only secrets, a dedicated staging Turnstile widget/domain, and a separate Cloudflare Worker staging hostname/environment. Enable anonymous Auth only on the Remix. Keep `writes_enabled=false` and `private_realtime_enabled=false`.

- [ ] **Step 3: Apply additive DB/Edge deployment**

Apply migrations in timestamp order excluding `20260724000000_atomic_capability_cutover.sql`. Deploy capability Edge APIs and cleanup. Set `writes_enabled=true`, leave private Realtime false, publish the immutable SPA, and seed only the synthetic fixtures.

- [ ] **Step 4: Prove polling and optional private mode**

With the platform's default/long JWT, prove polling, zero membership, and zero channel. If Lovable exposes an Auth lifetime at most 300 seconds, configure 300 seconds, inspect all logging surfaces for header redaction, then set `private_realtime_enabled=true` and prove private mode. If either proof fails or cannot be inspected, reset `private_realtime_enabled=false` and accept polling-only staging.

- [ ] **Step 5: Run browser, cleanup, and rollback gates**

```powershell
$env:LOVABLE_REMIX_URL = (gh variable get LOVABLE_REMIX_URL --env lovable-remix)
bun run test:e2e:lovable-remix
```

Expected: all zero-retry scenarios PASS. Exercise prune/anonymous cleanup, verify aggregate-only output, call `capability_runtime_set(false, false)`, prove reads remain available, HTTP writes return 503, Realtime sends fail RLS, outbox rows remain, then restore the staging test state.

- [ ] **Step 6: Attach sanitized evidence and obtain checkpoint review**

Run the evidence privacy contract before attaching it to the tracking PR. Obtain independent approval of migration order, rollback, logging evidence, JWT mode, and production backup procedure. Any staging source fix returns to Task 13 and requires a new immutable SHA/build.

### Task 15: Production additive release and 48-hour soak

**Files:**
- No source changes; use the immutable, reviewed artifact from Task 14.

- [ ] **Step 1: Create recoverable production evidence**

Record a production backup/PITR or support-confirmed restore checkpoint and run a restore proof against non-production data. Freeze the exact SPA, Edge, Worker, and migration hashes.

- [ ] **Step 2: Deploy in the proven order**

Deploy immediate-containment SQL/functions; deploy and verify the generic Cloudflare Worker on every alias; deploy `note-meta` tombstone only after Worker coverage; purge all `/s/*` HTML and historical `note-meta?slug=`/`?token=` variants or wait through the verified maximum expiry; apply additive capability/Auth migrations; deploy APIs; configure Turnstile/anonymous Auth; force polling unless both private gates passed; explicitly publish the immutable Lovable SPA.

- [ ] **Step 3: Start the continuous soak**

Run production smoke, then record aggregate-only API errors, auth denials, membership refresh/collision/revoke/expiry, Realtime reconnect/refresh, polling latency, outbox age/backlog, acknowledgement latency, duplicate update IDs, checkpoint conflicts, quarantines, and encrypted failures. Restart the clock after any deployment/configuration change or telemetry gap.

- [ ] **Step 4: Verify the 48-hour evidence**

```powershell
$soakEvidence = Join-Path $env:TEMP "snote-realtime-auth-soak-evidence.sanitized.json"
bun run soak:verify -- $soakEvidence
```

Expected: `realtime auth soak verified`. Any nonzero violation/failure, outbox stranding, cross-note success, secret finding, gap, or duration below 172,800 seconds blocks cutover.

### Task 16: Atomic cutover, main fast-forward, and branch cleanup

**Files:**
- No new source changes; this task operates only on the exact soaked artifact.

- [ ] **Step 1: Reverify the exact cutover artifact**

Take a fresh recoverable checkpoint and run:

```powershell
$cutoverEvidence = Join-Path $env:TEMP "snote-capability-cutover-evidence.approved.json"
bun run cutover:verify -- $cutoverEvidence
```

Expected: exit 0 for the exact Git SHA, build ID, Worker version/routes, migration hashes, backup reference, JWT mode, header-log proof, runtime state, and verified soak.

- [ ] **Step 2: Apply the atomic migration**

Apply only `supabase/migrations/20260724000000_atomic_capability_cutover.sql`. Verify anonymous users cannot list/update/delete direct tables; capability A cannot access note B; old capability-less notes are exact-match read-only; `/s/:token` compatibility is no-store; owner-only manage operations work; polling/private mode matches the approved production mode.

- [ ] **Step 3: Run rollback probes without reopening public tables**

Call `capability_runtime_set(false, false)`, prove reads continue and both HTTP/Realtime writes fail, verify all direct-table revocations remain, then restore the approved runtime flags. The rollback path is API read-only; never recreate permissive policies.

- [ ] **Step 4: Fast-forward `main` only after every gate is green**

Fetch, verify that the final release commit contains the soaked implementation and is a descendant of current `origin/main`, then fast-forward without force:

```powershell
git fetch origin --prune
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
```

Expected: merge-base exits 0 and the push reports a fast-forward update. Confirm the production deployment references the resulting main SHA and rerun smoke probes.

- [ ] **Step 5: Close stacked PRs and delete only merged remote branches**

List open PRs and remote branches, verify each branch tip is an ancestor of `origin/main`, close superseded stacked PRs with a link to the final main commit, then delete exact verified branch names:

```powershell
git branch -r --merged origin/main
git push origin --delete agent/ci-trust-baseline agent/security-immediate-containment agent/security-capability-backend agent/sync-capability-client agent/security-atomic-cutover agent/fix-product-correctness agent/chore-simplify-and-refresh
git fetch origin --prune
git branch -r
```

Expected: remote listing contains only `origin/main` and the symbolic `origin/HEAD -> origin/main`. Do not delete a branch whose tip is not an ancestor of main.

- [ ] **Step 6: Final verification**

Confirm required main checks are green, Lovable production is published at the main SHA, Cloudflare routes point to the verified Worker version, runtime flags match the approved mode, no secret appears in logs, and all post-cutover acceptance probes pass. Record only aggregate evidence and recoverable checkpoint references.
