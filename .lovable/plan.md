# Plan

## 1. Topbar: replace "Help" dropdown with direct Shortcuts trigger

`src/components/note/topbar/HelpMenu.tsx` currently renders a `<DropdownMenu>` with two items: "Keyboard shortcuts & tips" (opens dialog) and the "Split view" hint block. Since Split view is already explained inside the Shortcuts dialog itself (`shortcuts.tip.split_*`), the dropdown is redundant.

Change:
- Convert `HelpMenu` into a single `Button` that calls `onOpenShortcuts` directly — no DropdownMenu, no chevron.
- Label: short text + keyboard icon so it stays scannable. Use a new i18n key `menu.shortcuts` ("Shortcuts" / "Phím tắt" / "ショートカット" / etc.), with `t("help.shortcuts")` as the `aria-label`/tooltip for accessibility.
- Keep the `?` keyboard shortcut hint badge on the right (or move to a tooltip) so users know the key still works.
- Topbar wiring stays the same (`<HelpMenu onOpenShortcuts={…} />`).
- Remove the now-unused `help.split_label` / `help.split_hint` keys — they only existed for the dropdown body. Drop their usage in HelpMenu; leave the keys in the dict in case other code references them (will check & purge if unreferenced).

Tests to update: `e2e/i18n-export-help.spec.ts` and `e2e/i18n-modes.spec.ts` currently click the localized "Help" button and assert the Split-view text. Update them to click the new Shortcuts trigger and assert the dialog opens (heading from `shortcuts.title`).

## 2. Add German (DE) + Portuguese (PT)

`src/i18n/index.ts`:
- `Lang` type → add `"de" | "pt"`.
- `SUPPORTED_LANGS` → append `"de"`, `"pt"`.
- `LANG_NAMES` → `de: { native: "Deutsch", flag: "🇩🇪" }`, `pt: { native: "Português", flag: "🇵🇹" }`.
- `COUNTRY_LANG`: DE/AT → `de`; PT/BR/AO/MZ/CV/GW/ST/TL → `pt`. (CH stays `fr` to avoid breaking existing tests.)
- `detectFromNavigator`: add `de`/`pt` branches before the `en` fallback.
- `dict.de` and `dict.pt`: full translation of every key from `dict.en` (≈345 keys each), idiomatic and length-conscious so menu rows don't wrap.

Language selector (`src/components/LanguageToggle.tsx`) iterates `SUPPORTED_LANGS` already → automatically shows the two new entries with no code change.

## 3. Full i18n audit — wrap remaining hardcoded strings

Run `bun run scripts/i18n-audit.ts` (already wired) and fix every reachable user-facing string. Known offenders from `reports/i18n-audit.json` that ship to users:

- `src/components/DonateButton.tsx` line 59 → `aria-label` should use `t("donate.aria")` (new key).
- `src/components/note/OutlineSidebar.tsx` line 96 → `aria-label="Outline"` → `t("outline.aria")` (new key; reuse `brand.outline` value if appropriate).
- `src/lib/markdown/preview-worker.ts` lines 45/48 → "Đang tải biểu đồ…" / "Đang tải công thức…" inlined in worker HTML. Worker has no React context, so accept a labels prop from the client (`{ loadingChart, loadingFormula }`) passed when posting the render request; main thread resolves via `t()`. Add keys `preview.loading_chart`, `preview.loading_formula`.
- shadcn primitives (`breadcrumb.tsx`, `pagination.tsx`, `katex.ts` title) — unused in current product surfaces; add them to `.lintrc-i18n-allowlist.json` with reasons (library defaults, not user-visible copy) instead of churning shadcn internals.
- `src/hooks/use-sync-status.ts` & `mermaid-cache.ts` Vietnamese hits are code comments — translate comments to English to satisfy the audit and keep the codebase consistent.

After fixes, re-run `bun run scripts/i18n-audit.ts` and `bun run i18n:allowlist` and confirm both pass with zero unjustified hits.

## 4. Translations — quality bar

Every dict entry in `de` and `pt` must be a natural, idiomatic phrase a native UI writer would use — never a literal word-for-word port of English. Concrete rules:

- Keep length within ~120% of the English string; rewrite, don't transliterate, when a literal would overflow buttons/menu rows.
- Preserve placeholders verbatim (`{slug}`, `{n}`, `{bytes}`, `{code}`, `{when}`, `{ts}`, `{chars}`, `{page}`, `{total}`).
- Match register of existing locales: friendly-imperative for buttons/toasts ("Speichern", "Salvar"), descriptive for tooltips, microcopy for help text.
- Sweep the other 7 locales for entries added since their last review (any English string still present in a non-`en` dict gets rewritten in-language). This is bounded by the diff vs. `dict.en` — only stale leftovers need touching.

## 5. State persistence — verify, don't rewrite

`I18nProvider` already: writes `localStorage["lang"]`, sets `localStorage["lang.ip_detected"]="1"` on manual choice (skipping the IP probe forever after), syncs across tabs via the `storage` event, fires a same-tab `i18n:lang-changed` CustomEvent, and skips IP detection when a saved value exists. No code changes needed; existing tests in `src/i18n/__tests__/i18n.test.tsx` already cover these paths — we'll just add coverage for `de`/`pt` (navigator detection + country mapping).

## Verification

- `bun run build` (typecheck must pass — new langs added to union).
- Vitest: `bunx vitest run src/i18n` — coverage test will require every key present in `de`/`pt`.
- `bun run scripts/i18n-audit.ts` → 0 unjustified hits.
- `bun run i18n:allowlist` → green.
- Playwright: `bunx playwright test e2e/i18n-export-help.spec.ts e2e/i18n-modes.spec.ts e2e/i18n-shortcuts.spec.ts` after updating Help expectations.
- Manual: open `/`, switch to Deutsch then Português in the dropdown, refresh, confirm persistence; click new Shortcuts button → dialog opens.

## Out of scope

- Restyling the topbar beyond replacing the Help dropdown with a Shortcuts button.
- Refactoring shadcn primitives' English defaults (allowlisted instead).
- Translating long-form docs (`README.md`, `docs/*`, `public/llms.txt`) — keys-only product surface.
- Backend/edge-function copy (toasts originate client-side).
