# i18n audit diff

- files changed: **12**
- added findings: **23**
- removed findings: **0**

## `src/pages/SharePage.tsx`
before: 0 → after: 6

### + Added (6)
- `aria-literal` L59: `title = "Syrin Notes"`
- `meta-seo` L141: `<meta name="description" content="View a shared markdown note in read-only mode on Syrin Notes. Private link, revocable anytime."`
- `meta-seo` L144: `<meta property="og:title" content="Shared note — Syrin Notes"`
- `meta-seo` L145: `<meta property="og:description" content="A markdown note shared in read-only mode. Private link, revocable."`
- `meta-seo` L147: `<meta name="twitter:title" content="Shared note — Syrin Notes"`
- `meta-seo` L148: `<meta name="twitter:description" content="A markdown note shared in read-only mode."`

## `src/lib/markdown/renderers/mermaid-cache.ts`
before: 0 → after: 4

### + Added (4)
- `vietnamese` L1: `// Singleton LRU cache cho mermaid SVG output. Key gắn theme vì cùng code +`
- `vietnamese` L2: `// theme khác = SVG khác. Insertion-order eviction khi size > MAX.`
- `vietnamese` L3: `// Mục đích Phase 6: skip mermaid.render() call khi user xem lại note đã render`
- `vietnamese` L4: `// trước đó, hoặc khi cùng diagram xuất hiện trong nhiều note.`

## `src/components/ui/pagination.tsx`
before: 0 → after: 3

### + Added (3)
- `aria-literal` L11: `aria-label="pagination"`
- `aria-literal` L51: `aria-label="Go to previous page"`
- `aria-literal` L59: `aria-label="Go to next page"`

## `src/lib/markdown/preview-worker.ts`
before: 0 → after: 2

### + Added (2)
- `vietnamese` L45: `return \`<div class="mermaid-block my-3" data-mermaid="${enc}"><div class="text-muted-foreground text-sm">Đang tải biểu đồ…</div></div>\`;`
- `vietnamese` L48: `return \`<div class="katex-block my-3" data-katex="${enc}"><div class="text-muted-foreground text-sm">Đang tải công thức…</div></div>\`;`

## `src/components/DonateButton.tsx`
before: 0 → after: 1

### + Added (1)
- `aria-literal` L59: `aria-label="Support Syrin Notes"`

## `src/components/note/OutlineSidebar.tsx`
before: 0 → after: 1

### + Added (1)
- `aria-literal` L96: `aria-label="Outline"`

## `src/components/ui/breadcrumb.tsx`
before: 0 → after: 1

### + Added (1)
- `aria-literal` L12: `aria-label="breadcrumb"`

## `src/hooks/use-sync-status.ts`
before: 0 → after: 1

### + Added (1)
- `vietnamese` L90: `/** Clear the latched error (user clicked "Bỏ qua"). */`

## `src/lib/markdown/renderers/katex.ts`
before: 0 → after: 1

### + Added (1)
- `aria-literal` L32: `title="${escapeAttr(msg)}"`

## `src/lib/slash-commands.ts`
before: 0 → after: 1

### + Added (1)
- `vietnamese` L43: `text: "| Cột 1 | Cột 2 | Cột 3 |\n| --- | --- | --- |\n|  |  |  |\n",`

## `src/pages/AdminPanel.tsx`
before: 0 → after: 1

### + Added (1)
- `placeholder-literal` L284: `placeholder="Search by slug or content…"`

## `src/pages/SplitView.tsx`
before: 0 → after: 1

### + Added (1)
- `aria-literal` L73: `aria-label="Home"`
