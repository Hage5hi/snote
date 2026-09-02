# Cloudflare Worker — crawler containment

Worker này đang chạy ở chế độ containment tạm thời cho tới khi capability
backend/client được cutover. Slug cũ vẫn là edit credential, vì vậy crawler
không được nhận nội dung, slug, token hay canonical URL của một note.

Source Worker và cấu hình non-secret trong thư mục này khớp với Worker
production `syrin-prerender` đang chạy: git SHA `9fcc58bc`, Cloudflare
Version ID `b4d1a94e-b391-4682-841a-10dca111b1d6` (PR #52, 2026-09-02).
Origin SPA hiện là `4c846592` (xem §3e); không được coi origin là `9fcc58bc`.
Observability, logs, traces, và `workers_dev` vẫn tắt. Việc ghi nhận
identity này không cho phép một deployment mới. Xem
`docs/security-findings.md` §1c.

## Routing production bắt buộc

Canonical origin là `https://note.syrin.online`. Worker phải phủ cả ba host:

- `note.syrin.online/*`
- `syrin.online/*`
- `www.syrin.online/*`

Origin Pages đã được review là `snote-g4-origin.pages.dev`;
`snote.lovable.app` không phải origin hoặc rollback target. Không được cho alias
nào đi vòng qua Worker.

## Hành vi

- Browser bình thường: pass-through tới `ORIGIN_HOST`. Runtime/immutable
  asset chỉ forward query `__WB_REVISION__` hợp lệ; locator, token, home,
  public, note và share query vẫn bị strip.
- Crawler ở `/s/*`: generic HTML, `no-store`,
  `noindex,nofollow,noarchive,nosnippet`; không metadata/cache/redirect.
- Crawler ở `/<legacy-note-locator>`: generic HTML với cùng giới hạn; không
  đọc cache cũ và không gọi `note-meta`. Điều này chặn plaintext preview còn
  sống sau khi note được mã hóa.
- Crawler ở trang chủ: metadata tĩnh của sản phẩm; có thể cache ngắn hạn.
- Logs tùy chỉnh chỉ chứa loại route/bot/status/timing. Không log path, locator,
  token, nội dung hoặc IP thô.
- `invocation_logs = false` phải giữ nguyên vì Cloudflare có thể ghi raw URL
  trước khi mã Worker thực thi.
- Toàn bộ Worker observability, invocation logs, traces, `workers.dev` và
  preview URLs phải tiếp tục bị tắt.
- Các secret binding hiện do provider quản lý không được lưu trong repository.

## Triển khai

Dùng duy nhất `cloudflare-worker/wrangler.toml` đã commit:

```toml
name = "syrin-prerender"
main = "worker.js"
compatibility_date = "2024-11-01"
workers_dev = false
preview_urls = false

routes = [
  { pattern = "note.syrin.online/*", zone_name = "syrin.online" },
  { pattern = "syrin.online/*", zone_name = "syrin.online" },
  { pattern = "www.syrin.online/*", zone_name = "syrin.online" },
]

[vars]
ORIGIN_HOST = "snote-g4-origin.pages.dev"
SITE_URL = "https://note.syrin.online"

[observability]
enabled = false

[observability.logs]
enabled = false
invocation_logs = false

[observability.traces]
enabled = false
```

Một deployment mới phải có checkpoint phê duyệt riêng. Trước bất kỳ deployment
nào đã được phê duyệt, phải kiểm kê Workers Logs, Tail Workers, Workers Logpush,
traces và zone-level HTTP request datasets. Giữ toàn bộ observability disabled;
không tiếp tục nếu pipeline nào còn giữ raw note/share path.

## Thứ tự rollout

1. Tạo và xác minh backup/PITR checkpoint.
2. Deploy Worker mới trong staging.
3. Chứng minh crawler note/share nhận generic `no-store` trên mọi hostname,
   kể cả encoded separator, mixed case, trailing slash và asset-looking token.
4. Purge toàn bộ cache HTML preview note/share cũ và mọi cache của
   `note-meta`, không chỉ `note-meta?token=*`.
5. Chờ qua verified maximum expiry nếu không thể wildcard purge.
6. Chỉ sau đó mới tombstone `note-meta` và kiểm tra endpoint trả generic
   `410 no-store`.
7. Lặp lại test trên production trong checkpoint review riêng.

## Kiểm tra tối thiểu

```bash
curl -A "Slackbot-LinkExpanding 1.0" https://note.syrin.online/private-note -i
curl -A "Slackbot-LinkExpanding 1.0" https://note.syrin.online/s/<token> -i
curl -A "meta-externalagent/1.1" https://syrin.online/private-note -i
curl -A "Mozilla/5.0" https://note.syrin.online/private-note -I
```

Ba request crawler phải không chứa locator/token trong body hoặc headers, phải
có `Cache-Control: no-store` và `X-Robots-Tag:
noindex,nofollow,noarchive,nosnippet`. Request browser vẫn pass-through.

## Rollback

Rollback vẫn phải giữ generic containment cho cả note locator và `/s/*`.
Không bật lại content-bearing prerender/cache hoặc legacy `note-meta`. Nếu
Worker không thể phục vụ containment, vô hiệu hóa public aliases thay vì
pass-through private paths.
