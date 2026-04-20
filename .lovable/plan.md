

# Đề xuất tính năng quan trọng nên thêm

App đã có nền tảng vững (E2E encryption, realtime CRDT, PWA, zen/e-ink, pagination, admin, raw API). Dưới đây là các tính năng quan trọng còn thiếu, sắp xếp theo mức độ ưu tiên thực tế.

---

## 🔥 Ưu tiên cao — UX cốt lõi còn thiếu

### 1. Tìm kiếm trong note (Cmd+F)
Note dài hàng nghìn dòng mà không có search là trở ngại lớn. CodeMirror đã có sẵn `@codemirror/search` extension — chỉ cần bật. Hỗ trợ:
- Find/Replace, regex, case-sensitive
- Highlight tất cả match
- Phím tắt Cmd+F / Cmd+G next match

### 2. Markdown live preview (toggle)
Hiện chỉ có editor thuần text. Thêm nút toggle preview pane (chia đôi giống SplitView nhưng phải markdown):
- Render Markdown → HTML với `react-markdown` + `remark-gfm` (tables, task lists, strikethrough)
- Syntax highlight code block bằng `shiki` hoặc `highlight.js`
- Sync scroll giữa editor & preview
- Phím tắt Cmd+Shift+V

### 3. Outline / Table of Contents
Parse heading (`#`, `##`, `###`) trong Markdown, hiển thị sidebar trượt từ trái:
- Click để jump tới heading
- Highlight heading đang nằm trong viewport
- Toggle bằng Cmd+\

### 4. Recent notes / Note picker
`recent-notes.ts` đã có sẵn LocalStorage history nhưng không có UI mở danh sách. Thêm:
- Cmd+K palette: tìm note theo slug + jump nhanh
- Hiển thị 20 note gần nhất với preview snippet
- Pin note quan trọng

---

## 🟡 Ưu tiên trung — Productivity

### 5. Word count + reading time pill
Hiện có `char_count` ngầm trong DB nhưng UI không show. Thêm pill nhỏ ở footer:
- Số từ, số ký tự, ước lượng thời gian đọc (200 wpm)
- Selection mode: count riêng phần đang chọn

### 6. Export đa định dạng
`export.ts` đã có sẵn nhưng chỉ basic. Mở rộng:
- Markdown (.md) — đã có
- PDF (qua `html2pdf.js` từ markdown render)
- HTML standalone (inline CSS)
- Plain text (.txt)
- Nút "Download" trong Topbar dropdown

### 7. Slash commands (`/`)
Gõ `/` ở đầu dòng mở menu popup:
- `/h1`, `/h2`, `/h3` — heading
- `/code` — code block với chọn language
- `/table` — insert table template
- `/date` — insert ngày hiện tại
- `/todo` — checkbox list

### 8. Auto-save status chi tiết hơn
Hiện chỉ "Saved/Saving". Nâng cấp:
- Hiển thị "Saved 2s ago" với relative time
- Indicator offline (đỏ nhẹ) khi mất kết nối
- Click vào status → mở History dialog luôn

---

## 🟢 Ưu tiên thấp — Nice to have

### 9. Custom slug khi tạo note mới
Trang Home hiện random slug. Cho phép user gõ slug muốn dùng + check availability realtime.

### 10. Tags / Categories (lightweight)
Cho phép thêm `#tag` trong note → admin panel filter theo tag. Lưu tags trong cột mới `tags text[]`.

### 11. Share với QR code
Nút "Share" mở dialog có QR code của URL hiện tại (kèm `#key` nếu encrypted) → quick share giữa máy tính & điện thoại.

### 12. Diff view giữa snapshots
HistoryDialog hiện chỉ "view + restore". Thêm tab "Diff" so sánh 2 snapshot bất kỳ — dùng `diff` library, highlight đỏ/xanh từng dòng.

---

## Khuyến nghị triển khai

**Nên làm trước (Phase 3)**:
1. Tìm kiếm Cmd+F (#1) — quick win, CodeMirror có sẵn
2. Markdown preview (#2) — giá trị cao, hợp với hồ sơ "note app"
3. Recent notes Cmd+K (#4) — cải thiện navigation rõ rệt
4. Word count pill (#5) — nhỏ nhưng dùng nhiều

**Phase 4** (sau khi Phase 3 ổn):
5. Outline (#3)
6. Slash commands (#7)
7. Export PDF/HTML (#6)

**Phase 5** (polish):
8-12 còn lại

---

## Câu hỏi cho bạn

Bạn ưu tiên hướng nào nhất?
- **A. Đọc/viết hiệu quả hơn**: Search + Markdown preview + Outline (#1, #2, #3)
- **B. Navigation nhanh**: Cmd+K palette + custom slug + recent (#4, #9)
- **C. Productivity power-user**: Slash commands + export đa định dạng (#7, #6)
- **D. Bạn chọn list cụ thể** (nói cho tôi biết những số nào)

Sau khi bạn quyết, tôi sẽ trình plan chi tiết Phase 3.

