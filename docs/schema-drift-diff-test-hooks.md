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

## `atomicWrite` failure contract

`atomicWrite(dest, body, label)` in `scripts/schema-drift-diff.ts` is used by
both `--out` and `--json-out`. When it fails, it writes a **three-line** error
message to stderr and exits with code `7`. Tests MUST assert against these
exact shapes so future refactors cannot silently change the contract:

```
error: cannot write <label> to "<dest>": <errno-or-message>
  cleanup: <cleanup-line>
  fix: check that the parent directory exists and is writable, or pass a different --<label> path
```

Where `<cleanup-line>` is exactly one of:

- `removed partial temp file "<dest>.<pid>.tmp"` — the sibling `.tmp` file was
  successfully written and then unlinked during error recovery. This is what
  the `SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL` hook produces.
- `no temp file to remove at "<dest>.<pid>.tmp"` — the failure happened
  before/while creating the `.tmp` file (e.g. `mkdirSync` on a parent that is
  a regular file, or `EACCES` on the destination directory), so nothing was
  left to clean up.

Additional guarantees that tests may rely on:

1. Exit code is always `7` — never `1`, never process-signaled.
2. A pre-existing `<dest>` file is left **byte-for-byte unchanged** on every
   failure path.
3. `<dest>` paths containing spaces, unicode, or shell-metacharacters (`&`,
   `$`, `'`, parentheses) are supported — they appear verbatim inside the
   `"<dest>"` and `"<dest>.<pid>.tmp"` quoted segments.
4. Stale sibling `<dest>.<otherpid>.tmp` files whose pid is no longer alive
   are best-effort removed on the next successful write. Tmp files whose pid
   is still alive are left untouched so concurrent writers do not race.

## Running the nightly parallel `--json-out` stress test locally

The `schema-drift-diff-stress-nightly` CI job (see `.github/workflows/ci.yml`)
loops the parallel-writer / concurrency suites to surface race conditions in
the atomic rename and stale-`.tmp` cleanup paths. To reproduce it locally:

```bash
# One iteration — same filter CI uses.
bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts \
  -t "concurrency \+ tmp-file hygiene|stress \+ read-only \+ stderr wording|concurrent reader \+ fuzz \+ unsafe symlink" \
  --reporter=verbose

# N iterations back-to-back (default in CI = 5). Bump this if you are
# hunting a flake that only reproduces every ~50 runs.
ITERS="${SCHEMA_DRIFT_DIFF_STRESS_ITERATIONS:-25}"
for i in $(seq 1 "$ITERS"); do
  echo "=== stress iteration $i / $ITERS ==="
  bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts \
    -t "concurrency \+ tmp-file hygiene|stress \+ read-only \+ stderr wording|concurrent reader \+ fuzz \+ unsafe symlink" \
    --reporter=verbose || break
done
```

Tuning knobs:

- `SCHEMA_DRIFT_DIFF_STRESS_ITERATIONS` — how many times the whole suite is
  re-run in a row. CI defaults to `5` (overridable via the repo variable of
  the same name). Locally, `25`–`100` is a good range when reproducing a
  suspected race.
- The parallel-writer count inside the `stress + read-only + stderr wording`
  suite is fixed (6 writers) so the assertions stay deterministic. Increase
  it in the test itself only when hunting a specific rename-race regression,
  and revert before landing.
- To capture leftover `.tmp` siblings after a failed run, look under the OS
  temp dir (`$TMPDIR` on macOS/Linux, `%TEMP%` on Windows) for
  `schema-drift-report-*/…*.<pid>.tmp` — the same files CI uploads via the
  `schema-drift-diff-stress-debug-*` artifact on failure.
