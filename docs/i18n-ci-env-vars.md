# i18n allowlist — CI environment variables

The i18n allowlist gate runs in two CI surfaces:

1. **Allowlist check** (`bun run i18n:allowlist` or `i18n:allowlist:summary`) — validates `.lintrc-i18n-allowlist.json` against its schema and checks for drift. Writes `reports/i18n-allowlist-report.{json,md}`.
2. **PR comment** (`bun run i18n:allowlist:pr-comment`) — renders `reports/_i18n-allowlist-pr-comment.md` with pass/fail summary + links to the uploaded artifact bundle. Consumed by [`marocchino/sticky-pull-request-comment`](https://github.com/marocchino/sticky-pull-request-comment).

## Local CLI summary

A single command prints the concise summary (`schemaOk` / `driftOk` / `missing` / `stale`) read straight from `reports/i18n-allowlist-report.json`:

```sh
bun run i18n:allowlist:summary
# alias of: bun run i18n:allowlist:report
```

Exits non-zero when the report is failing — safe to wire into pre-commit / CI gates.

## Required environment variables

### Allowlist check step

No required env vars. Runs purely on the working tree.

### PR comment step

| Variable                | Required | Default / Fallback        | Provided by                                                 |
| ----------------------- | -------- | ------------------------- | ----------------------------------------------------------- |
| `GITHUB_SERVER_URL`     | yes      | `https://github.com`      | GitHub Actions runner (automatic)                           |
| `GITHUB_REPOSITORY`     | yes      | `<owner>/<repo>`          | GitHub Actions runner (automatic)                           |
| `GITHUB_RUN_ID`         | yes      | `0`                       | GitHub Actions runner (automatic)                           |
| `I18N_ARTIFACT_ID`      | no       | falls back to run-level   | `id` output of the preceding `actions/upload-artifact` step |
| `GITHUB_TOKEN`          | yes\*    | —                         | Auto-injected; needed by `sticky-pull-request-comment`      |

\* Required only for the sticky comment action itself, not for the comment builder.

When any of the three `GITHUB_*` vars is missing, the builder still writes the report — links degrade to placeholders and a warning is appended to the comment body listing exactly which vars were unset.

## Example workflow snippet

```yaml
# .github/workflows/ci.yml (excerpt)
jobs:
  i18n:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write   # required for sticky PR comment
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: i18n allowlist check
        id: allowlist
        run: bun run i18n:allowlist
        continue-on-error: true   # keep going so artifacts + PR comment still post

      - name: Upload i18n artifacts
        id: upload
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: i18n-report
          path: |
            reports/i18n-audit-diff.json
            reports/i18n-audit-diff.md
            reports/i18n-report.json
            reports/i18n-report.html
            reports/i18n-allowlist-report.json
            reports/i18n-allowlist-report.md
            .lintrc-i18n-allowlist.json

      - name: Build PR comment
        if: always() && github.event_name == 'pull_request'
        env:
          # Forward the artifact id so the comment links directly to the bundle.
          # GITHUB_SERVER_URL / GITHUB_REPOSITORY / GITHUB_RUN_ID are auto-injected.
          I18N_ARTIFACT_ID: ${{ steps.upload.outputs.artifact-id }}
        run: bun run i18n:allowlist:pr-comment

      - name: Post sticky PR comment
        if: always() && github.event_name == 'pull_request'
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: i18n-allowlist
          path: reports/_i18n-allowlist-pr-comment.md

      - name: Fail job on allowlist drift
        if: steps.allowlist.outcome == 'failure'
        run: exit 1
```

## Local pre-commit

The pre-commit hook (`.githooks/pre-commit`) runs the same gate locally and **fast-paths** by inspecting `git diff --cached`: the check only runs when the staged changeset touches `src/**/*.{ts,tsx,js,jsx}` or the allowlist config/schema. Set `I18N_HOOK_FORCE=1` to override, or `git commit --no-verify` to bypass entirely.
