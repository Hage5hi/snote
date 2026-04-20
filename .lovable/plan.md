

# Plan: Verify toàn bộ Phase 3 → Phase 6 chưa được test

## Mục tiêu
Test end-to-end tất cả tính năng đã build qua các phase nhưng chưa verify trực tiếp trên preview, đồng thời điều tra warning React đang xuất hiện trong console.

## Phát hiện từ console (cần fix trước)

```
Warning: Function components cannot be given refs.
Check the render method of `App`.
  at Home (...)
```

Có warning về `forwardRef` trong `App` → có thể `<Home>` hoặc một component khác đang nhận ref nhưng không dùng `forwardRef`. Cần kiểm tra `App.tsx` & `Home.tsx` để xác định nguồn (có thể từ `CommandPalette` hoặc Route children mới thêm).

## Các Phase cần verify

### Phase 3 — Editor utilities
- [ ] **Cmd+F**: mở search panel trong editor
- [ ] **Cmd+Shift+V**: toggle Markdown preview
- [ ] **Cmd+K**: mở Command Palette, search recent notes, tạo note mới
- [ ] **WordCountPill**: hiện ở góc dưới-trái với word count + reading time

### Phase 4 — Productivity
- [ ] **Cmd+\\**: toggle Outline sidebar, click heading nhảy đúng dòng
- [ ] **Slash commands**: gõ `/` đầu dòng mở popup, chèn `/h1`, `/code`, `/table`, `/date`
- [ ] **Export .html**: download file HTML standalone
- [ ] **Print to PDF**: mở print dialog

### Phase 5 — Polish
- [ ] **Share QR**: dialog hiện QR code, cảnh báo nếu URL có #key
- [ ] **History Diff**: tab Diff so sánh 2 snapshot, highlight đỏ/xanh
- [ ] **StatusPill**: hiển thị "Saved Xs ago", click mở History dialog

### Phase 6 — Tags & UX
- [ ] **Tags**: gõ `#tag1 #tag2` trong note → chip hiện ở Topbar
- [ ] **Tag autocomplete**: gõ `#` → popup gợi ý tag đã dùng
- [ ] **Admin filter by tag**: click chip → mở `/admin#tag=xxx` filter sẵn
- [ ] **Custom slug Home**: gõ slug đã tồn tại → badge "Đã có note"; gõ slug mới → "Available"

## Kế hoạch thực hiện

### Bước 1: Điều tra & fix warning forwardRef
Đọc `App.tsx`, `Home.tsx`, `CommandPalette.tsx`, `NotePage.tsx` để tìm component nhận ref bị thiếu `forwardRef`. Fix nếu phát hiện.

### Bước 2: Browser test theo flow
1. Vào `/` → kiểm tra Home (custom slug check, recent notes)
2. Cmd+K palette
3. Tạo note mới `/verify-test`
4. Gõ nội dung markdown có headings + `#tag1 #tag2`
5. Test Cmd+F, Cmd+Shift+V, Cmd+\\, slash `/`
6. Test Topbar: word count, status pill, share QR, export HTML, history diff, tag chips
7. Vào `/admin` qua tag chip → verify filter

### Bước 3: Báo cáo kết quả
- Liệt kê pass/fail từng tính năng
- Nếu phát hiện bug → fix ngay rồi báo lại
- Screenshot các state quan trọng (Topbar có chips, Outline sidebar mở, History Diff)

## Lưu ý
- Một số phím tắt như `Cmd+\\` có thể bị browser/OS chặn — sẽ test cả qua nút bấm nếu có.
- Tag extraction chỉ chạy với note **không mã hoá** — sẽ test với note plain.
- `Print to PDF` mở native print dialog → chỉ verify dialog xuất hiện, không thực sự in.

