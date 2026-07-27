# i18n verification

The i18n gates are local, deterministic commands and require no environment
variables:

```sh
bun run i18n:check
bun run i18n:audit
bun run i18n:allowlist
```

They validate locale key coverage, English fallbacks and the hardcoded-string
allowlist. The allowlist validator writes one ignored JSON/Markdown report
pair under `reports/` for local diagnostics.

The repository does not post sticky PR comments. The stable `quality` check is
the single merge gate for lint, typecheck, unit coverage, build and audit.
