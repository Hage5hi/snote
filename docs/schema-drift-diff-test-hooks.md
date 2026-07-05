# schema-drift-diff test-only hooks

These hooks exist **only** to make failure branches of `scripts/schema-drift-diff.ts`
deterministically reproducible in integration tests. They are read from
`process.env` at runtime and must never be set outside of tests.

## `SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL`

- **Where:** `atomicWrite()` in `scripts/schema-drift-diff.ts`.
- **Enable:** set to `"1"` in the child process environment.
- **Simulates:** a mid-write failure that happens **after** the sibling
  `<dest>.<pid>.tmp` file has been written but **before** `renameSync` promotes
  it over `<dest>`. This is the same class of failure as "no space left on
  device" or an EIO during flush.
- **Observable behavior when enabled:**
  - Process exits with code `7`.
  - Stderr contains `cannot write <label> to "<dest>"` and a
    `cleanup: removed partial temp file "<tmp>"` line.
  - The partial `<dest>.<pid>.tmp` file is unlinked.
  - A pre-existing `<dest>` file is left **byte-for-byte unchanged**.

## `SCHEMA_DRIFT_DIFF_FORCE_INVALID`

- **Where:** the `--validate-json` branch of `main()`.
- **Enable:** set to any truthy value.
- **Simulates:** an Ajv schema mismatch by feeding `{ totals: "nope" }` into the
  validator instead of the real payload. Used to exercise the
  `json-schema-mismatch` (exit 6) failure path without having to construct a
  bogus payload.

## Conventions for new hooks

1. Prefix every hook env var with `SCHEMA_DRIFT_DIFF_FORCE_` so they are easy
   to grep for and obviously test-only.
2. Never branch on a hook in a way that changes success-path output — hooks
   must only turn success paths into their matching failure paths.
3. Document every new hook here in the same shape (Where / Enable / Simulates
   / Observable behavior) so tests that rely on the hook can reference the
   exact stderr and exit code they should assert against.
