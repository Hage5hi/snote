# Syrin Notes

Realtime markdown notes by URL. Create, share, and edit notes that sync across devices and work offline.

**Live:** [syrin.online](https://syrin.online/)

## Features

- **Instant notes by URL** — visit `syrin.online/my-note` to create or open a note
- **Realtime sync** — edits sync across devices via Supabase Realtime + Yjs CRDT
- **Offline support** — PWA with IndexedDB persistence, works without connectivity
- **Markdown editor** — CodeMirror 6 with syntax highlighting, Vim mode, and typewriter mode
- **Live preview** — rendered markdown with KaTeX math, Mermaid diagrams, and code highlighting
- **Split view** — side-by-side editor + preview (e.g. `syrin.online/my-note+preview`)
- **Share links** — revocable token-based read-only sharing (`/s/:token`)
- **Encryption** — optional passphrase-based note locking
- **Note history** — snapshot diffs to review past edits
- **Tags & pinning** — organize notes with tags and pin favorites
- **Word count & goals** — track progress with word count and configurable targets
- **Zen mode & focus line** — distraction-free writing modes
- **E-ink mode** — optimized display for e-ink screens
- **Command palette** — quick access to actions via keyboard
- **i18n** — English, Vietnamese, Chinese, Japanese, Korean, French, Spanish
- **Dark / light theme** — system-aware with manual toggle
- **Presence indicators** — see who else is viewing a note
- **SEO prerendering** — Cloudflare Worker serves OpenGraph meta to crawlers

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Editor:** CodeMirror 6, Yjs (CRDT)
- **Backend:** Supabase (Postgres, Realtime, Edge Functions)
- **Prerender:** Cloudflare Worker ([details](cloudflare-worker/README.md))
- **Testing:** Vitest (unit), Playwright (e2e)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (or [Bun](https://bun.sh/))

### Setup

```sh
git clone https://github.com/Hageshiku/snote.git
cd snote
bun install      # or: npm install
bun run dev      # start dev server at http://localhost:5173
```

Copy `.env.example` to `.env` if not already present — it contains the public Supabase keys needed for local development.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (zero warnings) |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | E2E tests (Playwright) |
| `npm run preview` | Preview production build |

## Project Structure

```
src/
  components/     # UI components (note/, admin/, ui/)
  hooks/          # Custom React hooks
  i18n/           # Internationalization
  integrations/   # Supabase client
  pages/          # Route pages (Home, NotePage, SplitView, etc.)
cloudflare-worker/  # Prerender worker for SEO
supabase/           # Migrations and edge functions
e2e/                # Playwright end-to-end tests
docs/               # Architecture and i18n docs
```

## i18n Allowlist — Pre-commit Hook

This repo ships a Git pre-commit hook that runs the i18n hardcoded-string
allowlist gate locally so drift (missing or stale `eslint-disable`
entries) is caught before it reaches CI. See
[`docs/i18n-allowlist-report.md`](docs/i18n-allowlist-report.md) for what
the report fields mean.

### Install

Run once per clone (also runs automatically via `prepare` after
`bun install` / `npm install`):

```sh
bun run hooks:install
# or, manually:
git config core.hooksPath .githooks
```

### Verify

Confirm the hook is wired and the gate currently passes:

```sh
git config --get core.hooksPath          # → .githooks
bun run i18n:allowlist:report            # prints schemaOk / driftOk / missing / stale
```

The hook script lives at [`.githooks/pre-commit`](.githooks/pre-commit)
and shells out to `bun run i18n:allowlist:report`.

### Bypass (emergency only)

If you genuinely need to commit while the gate is failing (e.g. WIP),
skip the hook with:

```sh
git commit --no-verify -m "wip: …"
```

CI will still run the same check on the PR, so don't ship code that
relies on bypassing.

## Visual regression CLI — `--scene-diff` / `--chrome-diff`

The Playwright scene specs accept two independent pixel-diff threshold
axes, plumbed through the `e2e:*:changed` wrapper scripts and into the
`SCENE_DIFF_RATIOS`, `CHROME_DIFF_RATIO`, and `CHROME_SCENE_DIFF_RATIOS`
env vars that `e2e/helpers/pixel-diff.ts` reads.

| Flag | What it controls | Repeatable | Glob? |
|---|---|---|---|
| `--scene-diff <id\|glob>=<ratio>` | Masked scene layer + hit-test specs | Yes | Yes |
| `--chrome-diff <ratio>` | Chrome screenshot (Header / slug input / Recents), global | No | No |
| `--chrome-scene-diff <id\|glob>=<ratio>` | Chrome screenshot, per scene | Yes | Yes |
| `--strict-scene-diff` | Exit non-zero on unknown id / empty glob | — | — |

Always **quote globs** so the shell doesn't try to expand them against
your working directory:

```sh
# Loosen one scene
bun run test:e2e:update:changed --scene-diff neon-vapor=0.05

# Tighten chrome globally while keeping shader scenes loose
bun run test:e2e:changed --chrome-diff 0.015 --scene-diff "neon-*=0.05"

# Tune a whole family + override one member tighter
bun run test:e2e:changed \
  --scene-diff "ethereal-*=0.04" \
  --scene-diff "obsidian-ink=0.012"

# Per-scene chrome thresholds via glob
bun run test:e2e:changed --chrome-scene-diff "neon-*=0.02"

# Fail loudly on a typo during a baseline update
bun run test:e2e:update:changed --strict-scene-diff --scene-diff neon-vapr=0.05
```

Precedence when multiple flags overlap the same scene id is **last
flag wins** — a later literal overrides an earlier wildcard match and
vice versa. The CI summary renders a `Scene-diff wildcard expansions`
table only when failures are present, focused on patterns that touched
a failing scene.

## License

Private.

