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

## Running the concurrent-reader, fuzz, and unsafe-symlink tests locally

All three tests live in `scripts/__tests__/schema-drift-pr-comment.test.ts`
under the describe block `--json-out concurrent reader + fuzz + unsafe symlink`.

```bash
# Whole suite (concurrent reader + fuzz + unsafe symlink + snapshot).
bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts \
  -t "concurrent reader \+ fuzz \+ unsafe symlink" \
  --reporter=verbose

# Just the concurrent-reader test. Extend the window when hunting a race —
# the default 300ms is enough on a warm laptop but often too short on a busy
# CI runner or under `nice`.
SCHEMA_DRIFT_DIFF_READER_DURATION_MS=2000 \
  bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts \
    -t "concurrent reader observes only fully-written" \
    --reporter=verbose

# Fuzz test with a specific replay seed. The test always prints the seed it
# ran with as `fuzz seed: <n> (SCHEMA_DRIFT_DIFF_FUZZ_SEED=<n> to replay)`;
# copy that value here to replay the exact same 12 cases.
SCHEMA_DRIFT_DIFF_FUZZ_SEED=12648430 \
  bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts \
    -t "fuzz: varied valid reports" \
    --reporter=verbose

# Unsafe-symlink test (skipped on Windows because POSIX symlinks are
# required). No env knobs — the assertions are deterministic.
bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts \
  -t "symlink pointing to a directory" \
  --reporter=verbose

# Snapshot test that pins the exact atomicWrite stderr contract across
# every failure mode. Update snapshots with `-u` when the wording changes
# on purpose; every other test in this suite asserts a subset of this shape.
bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts \
  -t "atomicWrite stderr matches a normalized snapshot" \
  --reporter=verbose
```

Env-var summary (all optional, all safe to leave unset locally):

| Variable | Test it affects | Default | Purpose |
| --- | --- | --- | --- |
| `SCHEMA_DRIFT_DIFF_FUZZ_SEED` | fuzz | `0xC0FFEE` (`12648430`) | Replay a specific fuzz run. |
| `SCHEMA_DRIFT_DIFF_READER_DURATION_MS` | concurrent reader | `300` | Widen the reader window when hunting a rename race. |
| `SCHEMA_DRIFT_DIFF_STRESS_ITERATIONS` | stress nightly loop | `5` (CI) | Loop count for the nightly stress harness. |
| `SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL` | atomicWrite | unset | Force the mid-write failure branch (see above). |
| `SCHEMA_DRIFT_DIFF_FORCE_INVALID` | `--validate-json` | unset | Force the Ajv-mismatch branch (see above). |

## Replay helper: `scripts/replay-schema-drift-diff-fuzz.sh`

When a `--json-out` fuzz/concurrent-reader run fails in CI, the job log
contains a `schema-drift-diff replay block` group with the exact env vars
used. Feed them to the replay helper to rerun locally with output archived
to a timestamped folder:

```bash
# From the block: SCHEMA_DRIFT_DIFF_FUZZ_SEED=12648430 …
scripts/replay-schema-drift-diff-fuzz.sh 12648430
scripts/replay-schema-drift-diff-fuzz.sh 12648430 2000
scripts/replay-schema-drift-diff-fuzz.sh 12648430 2000 "fuzz: varied valid"
```

Outputs land under `artifacts/schema-drift-diff-replay/<UTC-timestamp>-seed-<seed>/`
(`manifest.txt`, `vitest.stdout.log`, `vitest.stderr.log`) so multiple
replays do not overwrite each other.

## Additional CI-exposed env knobs

Both the atomic-crossos job and the nightly stress job read these
**optional** repo-level variables. Setting them in
`Settings → Secrets and variables → Actions → Variables` overrides the
defaults for every subsequent CI run and mirrors the local env vars a
contributor would set to reproduce a flake.

| Repo variable | Local env var | Default | Purpose |
| --- | --- | --- | --- |
| `SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN` | same | job-specific | Overrides the vitest `-t` filter. Use to bisect down to a single failing test. |
| `SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS` | same | `30000` (crossos) / `60000` (stress) | Overrides `vitest --test-timeout`. Bump when reproducing a slow race. |
| `SCHEMA_DRIFT_DIFF_FUZZ_SEED` | same | LCG default (`12648430`) | Pins the fuzz seed. Appears in the CI replay block on failure. |
| `SCHEMA_DRIFT_DIFF_READER_DURATION_MS` | same | `300` | Widens the concurrent-reader window. |
| `SCHEMA_DRIFT_DIFF_STRESS_ITERATIONS` | same | `5` | Number of full-suite loops in the nightly stress job. |

## Replay helper flags: `--dry-run`, `--test-name-pattern`, `--print-manifest`

`scripts/replay-schema-drift-diff-fuzz.sh` supports three non-executing
flags that let you inspect and verify a replay folder without invoking
`vitest`. They compose with both the positional form
(`<SEED> [READER_MS] [PATTERN]`) and the CI form (`--from <FOLDER>`).

### `--dry-run` — verify checksums + files, print the exact command

Materializes the timestamped replay folder (`manifest.txt`, `env.sh`,
`checksums.sha256`), runs the same integrity checks the real replay does,
writes `replay-summary.txt`, then exits `0` **without** executing vitest.
Exits `8` on any missing/unreadable file or checksum mismatch. This is
what CI uses on failure to pre-validate the artifact before running the
real replay.

```bash
scripts/replay-schema-drift-diff-fuzz.sh 12648430 500 "concurrent reader" --dry-run
```

Expected tail of stderr:

```
pre-replay: OK   checksums verified
command: SCHEMA_DRIFT_DIFF_FUZZ_SEED=12648430 SCHEMA_DRIFT_DIFF_READER_DURATION_MS=500 bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts -t concurrent\ reader --testTimeout=30000 --reporter=verbose
dry-run: verification complete, not executing vitest
```

Expected `artifacts/schema-drift-diff-replay/<ts>-seed-<seed>/replay-summary.txt`:

```
mode:                dry-run
checksum_verified:   ok
would_run:           bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts -t concurrent reader --testTimeout=30000 --reporter=verbose
seed:                12648430
reader_ms:           500
pattern:             concurrent reader
timeout_ms:          30000
```

### `--test-name-pattern <p>` — override the vitest `-t` filter

Takes precedence over both the 3rd positional argument and the
`SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN` value in a `--from` manifest.
Useful when you want to replay a captured seed but narrow to a single
failing test name without editing `env.sh`.

```bash
scripts/replay-schema-drift-diff-fuzz.sh \
  --from ./replay-download/20260705T111030Z-seed-777 \
  --test-name-pattern "concurrent reader observes only fully-written" \
  --dry-run
```

Expected: the resulting `replay-summary.txt` shows
`pattern:             concurrent reader observes only fully-written` and
`would_run: … -t concurrent reader observes only fully-written …`,
regardless of what the manifest's `SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN`
line says.

### `--print-manifest` — pretty-print manifest + derived fields

Prints the raw manifest followed by a `-- derived --` block with
`seed`, `reader_ms`, `test_pattern`, and `timeout_ms` extracted for
readability. Exits `0`. Combine with `--from` to inspect a downloaded CI
artifact without running anything.

```bash
scripts/replay-schema-drift-diff-fuzz.sh --from ./replay-download/20260705T111030Z-seed-777 --print-manifest
```

Expected output:

```
== manifest: ./replay-download/20260705T111030Z-seed-777/manifest.txt ==
timestamp_utc:                          20260705T111030Z
SCHEMA_DRIFT_DIFF_FUZZ_SEED:            777
SCHEMA_DRIFT_DIFF_READER_DURATION_MS:   100
SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN:    concurrent reader observes only fully-written
SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS:      30000
…

-- derived --
seed          = 777
reader_ms     = 100
test_pattern  = concurrent reader observes only fully-written
timeout_ms    = 30000
```

### CI integration

The `schema-drift-diff-atomic-crossos` and `schema-drift-diff-stress-nightly`
jobs use these flags on failure in this order:

1. **prepare replay folder on failure (dry-run materialize)** — runs the
   helper with `--dry-run` to write the folder + `checksums.sha256`
   without invoking vitest.
2. **dry-run verify replay folder integrity** — `--from <folder> --dry-run`
   fails the job step (exit `8`) if any required file is missing or a
   checksum mismatches, so a corrupt upload never silently produces an
   unusable replay artifact.
3. **materialize replay folder on failure (real replay)** — `--from
   <folder>` executes the real vitest command against the verified
   folder (with `|| true` so the expected re-failure doesn't hide the
   uploaded logs).
4. **print copy-paste replay command** — appends the labeled
   `gh run download …` + `scripts/replay-schema-drift-diff-fuzz.sh --from …`
   block **and** `replay-summary.txt` to `$GITHUB_STEP_SUMMARY` so
   debuggers can grab them without opening job logs.

Regression coverage for these flags lives in
`scripts/__tests__/replay-schema-drift-diff-fuzz.test.ts`.
