# i18n Allowlist Validation Report

**Status:** ✅ PASS  ·  Schema: ✅  ·  Drift: ✅

- Entries: **8**
- Schema errors: **0**
- Missing (unallowlisted disables): **0**
- Stale (no source match): **0**

## Per-entry results

| # | File | Reason | Status | Matched sites |
|---|------|--------|--------|---------------|
| 0 | `src/components/DonateButton.tsx` | brand label | ✅ | `src/components/DonateButton.tsx:29` |
| 1 | `src/components/note/OutlineSidebar.tsx` | static landmark label | ✅ | `src/components/note/OutlineSidebar.tsx:95` |
| 2 | `src/components/dev/DiagnosticsPanel.tsx` | internal dev-only UI | ✅ | `src/components/dev/DiagnosticsPanel.tsx:299` |
| 3 | `src/pages/AdminPanel.tsx` | internal admin-only UI | ✅ | `src/pages/AdminPanel.tsx:591` |
| 4 | `src/pages/NotePage.tsx` | SEO control value | ✅ | `src/pages/NotePage.tsx:778`<br>`src/pages/NotePage.tsx:782` |
| 5 | `src/pages/RawView.tsx` | SEO control value | ✅ | `src/pages/RawView.tsx:120` |
| 6 | `src/pages/SharePage.tsx` | crawler-facing SEO copy (page is noindex) | ✅ | `src/pages/SharePage.tsx:406` |
| 7 | `src/pages/SplitView.tsx` | SEO control value | ✅ | `src/pages/SplitView.tsx:135` |
