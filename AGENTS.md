# AGENTS.md

## Cursor Cloud specific instructions

Snote is a Vite + React 19 + TypeScript single-page app (realtime Markdown notes).
Standard commands live in `README.md` (Local development / Verification) and
`package.json` scripts; prefer those. Notes below are the non-obvious bits.

### Toolchain
- Package manager is **Bun `1.3.14`** (pinned via `packageManager`); Edge Function
  typechecking needs **Deno `2.9.3`**. Both are preinstalled and on `PATH` for
  interactive shells (`~/.bun/bin`, `~/.deno/bin` via `~/.bashrc`).
- System `node` is older than the repo's `engines` floor (`>=22.22.0`), but Bun
  ships its own Node-compat that satisfies it. Always run scripts through
  `bun run ...` / `bunx ...`, never `npm`/`node` directly.

### Running the app
- `bun run dev` serves the SPA on **http://localhost:8080** (port is fixed in
  `vite.config.ts`).
- `.env` is committed with a *publishable* Supabase anon config pointing at a
  hosted Supabase project. No local Supabase stack is needed for normal dev, and
  created notes sync to that real hosted backend (the editor shows "Synced").

### Testing / checks
- `bun run test` (Vitest) runs fully offline; the integration test spins up an
  in-process Postgres via `@electric-sql/pglite`.
- `bun run typecheck:edge` runs `deno check` and downloads Supabase type deps
  from `esm.sh` on first run, so it needs network access the first time.
- E2E: `bun run test:e2e` (wrapper `scripts/run-playwright.sh`). It tries
  `bunx playwright install --with-deps chromium`; if that is unavailable set
  `PLAYWRIGHT_FORCE_SYSTEM_CHROMIUM=1` (and optionally
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) to use a system Chromium.

### Git hooks
- Hooks are opt-in: `bun run hooks:install` sets `core.hooksPath=.githooks`. The
  pre-commit hook only runs the i18n allowlist check for i18n-relevant staged
  files.
