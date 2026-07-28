# Cloudflare Worker — crawler containment

Worker này đang chạy ở chế độ containment tạm thời cho tới khi capability
backend/client được cutover. Slug cũ vẫn là edit credential, vì vậy crawler
không được nhận nội dung, slug, token hay canonical URL của một note.

## Routing production bắt buộc

Canonical origin là `https://note.syrin.online`. Worker phải phủ cả ba host:

- `note.syrin.online/*`
- `syrin.online/*`
- `www.syrin.online/*`

Direct origin `snote.lovable.app` phải non-public/disabled hoặc có containment
tương đương. Không được cho alias nào đi vòng qua Worker.

## Hành vi

- Browser ở route private: nhận cùng SPA shell từ `/` (hoặc `/s` cho share
  compatibility) nhưng URL/path/query private không được chuyển tới origin.
- Browser ở `/`, `/privacy` và static asset: pass-through tới `ORIGIN_HOST`;
  query của hai public document bị bỏ khỏi origin request nhưng vẫn còn trong
  URL trình duyệt để SPA xử lý.
- Crawler ở `/s/*`: generic HTML, `private, no-store`,
  `noindex, nofollow, noarchive, nosnippet`; không metadata/cache/redirect.
- Crawler ở `/<legacy-note-locator>`: generic HTML với cùng giới hạn; không
  đọc cache cũ và không gọi `note-meta`. Điều này chặn plaintext preview còn
  sống sau khi note được mã hóa.
- Crawler ở trang chủ: metadata tĩnh của sản phẩm; có thể cache ngắn hạn.
- Logs tùy chỉnh chỉ chứa loại route/bot/status/timing. Không log path, locator,
  token, nội dung hoặc IP thô.
- `invocation_logs = false` phải giữ nguyên vì Cloudflare có thể ghi raw URL
  trước khi mã Worker thực thi.

`wrangler.staging.toml` là fail-closed scaffold: `ORIGIN_HOST` và `SITE_URL`
chỉ là placeholder. Không deploy staging cho tới khi hostname, origin cô lập và
release-manifest entry tương ứng đã được review.

## Triển khai

Dùng duy nhất `cloudflare-worker/wrangler.toml` đã commit:

```toml
routes = [
  { pattern = "note.syrin.online/*", zone_name = "syrin.online" },
  { pattern = "syrin.online/*", zone_name = "syrin.online" },
  { pattern = "www.syrin.online/*", zone_name = "syrin.online" }
]

[vars]
ORIGIN_HOST = "snote.lovable.app"
SITE_URL = "https://note.syrin.online"

[observability]
enabled = false

[observability.logs]
invocation_logs = false

[observability.traces]
enabled = false
```

Trước deploy phải kiểm kê Workers Logs, Tail Workers, Workers Logpush, traces và
zone-level HTTP request datasets. Giữ toàn bộ Worker observability tắt trong
giai đoạn capability legacy; không tiếp tục nếu pipeline nào còn giữ raw
note/share path.

Worker trả `410 no-store` cho `/~flock.js` và `204 no-store` cho toàn bộ prefix
`/~api/analytics` trước khi request có thể tới Lovable origin.

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
có `Cache-Control: private, no-store` và `X-Robots-Tag:
noindex, nofollow, noarchive, nosnippet`. Request browser private nhận SPA shell
đã containment, không chuyển raw private path tới origin.

## Rollback

Rollback vẫn phải giữ generic containment cho cả note locator và `/s/*`.
Không bật lại content-bearing prerender/cache hoặc legacy `note-meta`. Nếu
Worker không thể phục vụ containment, vô hiệu hóa public aliases thay vì
pass-through private paths.
