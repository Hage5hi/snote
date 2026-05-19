# Hardcoded-String Allowlist (i18n)

The ESLint rule `no-restricted-syntax` (see `eslint.config.js`) blocks string
literals on `placeholder`, `aria-label`, `title`, and `<meta content="…">`
JSX attributes so all user-facing copy goes through `t()`.

A small set of strings are intentionally hardcoded — brand wordmarks,
crawler-only SEO control values, and admin-only internal UI. Those are
tracked in [`.lintrc-i18n-allowlist.json`](../.lintrc-i18n-allowlist.json).

## How it works

1. In source code, prefix the literal with a justification:

   ```tsx
   // eslint-disable-next-line no-restricted-syntax -- brand label
   <button aria-label="Donate">…</button>
   ```

2. Add a matching `{ file, reason }` entry to `.lintrc-i18n-allowlist.json`.
   The `reason` must equal the text after `--` in the disable comment.

3. CI runs `bun run i18n:allowlist` (script `scripts/i18n-allowlist-check.ts`)
   on every PR and fails when:
   - A disable comment has no matching allowlist entry, **or**
   - An allowlist entry is no longer referenced (stale).

## When NOT to add to the allowlist

- Toasts, dialog labels, menu items, error messages — translate via `t()`.
- Anything a user reads in any of the 7 supported locales.

## Audit chain

```
no-restricted-syntax (eslint)
  └── eslint-disable -- <reason>  (justified inline)
        └── .lintrc-i18n-allowlist.json  (audited list)
              └── scripts/i18n-allowlist-check.ts  (CI gate)
```
