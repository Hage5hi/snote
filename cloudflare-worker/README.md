# Cloudflare Worker — Prerender meta cho crawler

Worker đặt **trước** `syrin.online` để render HTML với `og:*`, `twitter:*`,
`canonical`, `robots` theo từng note URL cho crawler không chạy JavaScript
(LinkedIn, Slack, Facebook, Discord, WhatsApp, Telegram, Twitter…).

User thật và Googlebot vẫn được pass-through tới Lovable hosting và nhận
SPA gốc với `react-helmet-async`.

## Cách hoạt động

```
       crawler? ──yes──▶ edge cache hit? ──yes──▶ trả ngay
                              │ no
                              ▼
                  fetch /functions/v1/note-meta (kèm x-meta-secret)
                              │
                              ▼
                       render HTML <head> + lưu cache
request──┤
       └─no──▶ proxy tới snote.lovable.app (origin Lovable)
```

- Phát hiện crawler bằng User-Agent (regex `CRAWLER_UA` trong `worker.js`).
- Endpoint `note-meta` được bảo vệ bằng shared secret `NOTE_META_SECRET`
  (Worker gửi qua header `x-meta-secret`).
- Edge cache 5 phút + SWR 1 giờ cho note bình thường, 60 giây cho note
  mã hoá / 404.
- Note mã hoá (`isEncrypted: true`) tự động nhận
  `noindex, nofollow, noarchive, nosnippet, noimageindex, nocache`
  cộng với header `X-Robots-Tag` tương ứng.
- Slug và share token được chuẩn hoá (decode URI, strip slash, regex
  validate) trước khi gọi backend.

## Triển khai

1. **Trỏ domain qua Cloudflare**
   - Thêm `syrin.online` vào Cloudflare account.
   - Cập nhật nameserver tại registrar theo hướng dẫn Cloudflare.
   - DNS: `CNAME syrin.online → snote.lovable.app`, bật proxy (orange).
   - Tương tự cho `www.syrin.online` (worker tự 301 về apex).

2. **Cài Wrangler**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

3. **Tạo `wrangler.toml`** trong thư mục `cloudflare-worker/`:
   ```toml
   name = "syrin-prerender"
   main = "worker.js"
   compatibility_date = "2024-11-01"

   routes = [
     { pattern = "syrin.online/*", zone_name = "syrin.online" },
     { pattern = "www.syrin.online/*", zone_name = "syrin.online" }
   ]

   [vars]
   ORIGIN_HOST = "snote.lovable.app"
   SUPABASE_PROJECT = "onfzjmfjldsbthchssfr"
   SITE_URL = "https://syrin.online"
   ```

4. **Set secret** (cả hai đều bắt buộc):
   ```bash
   wrangler secret put SUPABASE_ANON_KEY
   # paste anon key (có sẵn trong src/integrations/supabase/client.ts)

   wrangler secret put NOTE_META_SECRET
   # paste đúng value đã lưu trong Lovable Cloud (Supabase Edge secret cùng tên)
   ```

5. **Deploy**
   ```bash
   wrangler deploy
   ```

## Kiểm tra

```bash
# Note bình thường (lần 2 phải HIT cache, header age > 0)
curl -A "facebookexternalhit/1.1" https://syrin.online/my-note-slug -i | head -40

# Share link
curl -A "Slackbot-LinkExpanding 1.0" https://syrin.online/s/<token> -i | head -40

# Trình duyệt thường (pass-through, không có x-prerendered)
curl -A "Mozilla/5.0" https://syrin.online/my-note-slug -I

# Note mã hoá → phải có X-Robots-Tag: noindex
curl -A "LinkedInBot/1.0" https://syrin.online/<encrypted-slug> -i | head -40
```

Hoặc dùng debugger chính chủ:
- LinkedIn: <https://www.linkedin.com/post-inspector/>
- Facebook: <https://developers.facebook.com/tools/debug/>
- Twitter/X: <https://cards-dev.twitter.com/validator>
- Slack: paste link vào kênh test.

## Endpoint Edge Function

```
GET https://onfzjmfjldsbthchssfr.functions.supabase.co/note-meta?slug=<slug>
GET https://onfzjmfjldsbthchssfr.functions.supabase.co/note-meta?token=<share-token>
Header: x-meta-secret: <NOTE_META_SECRET>
```

Trả JSON `{ found, slug, isEncrypted, snippet, charCount, tags, updatedAt }`.
Sai secret → 403. Note mã hoá → không trả `snippet`.

## Bảo trì

- Thêm crawler UA mới: cập nhật regex `CRAWLER_UA` trong `worker.js`.
- Đổi domain: cập nhật `SITE_URL` và `routes` trong `wrangler.toml`.
- Xoay secret: `wrangler secret put NOTE_META_SECRET` ở Cloudflare và
  cập nhật cùng value trong Lovable Cloud → Settings → Secrets.
- Bypass tạm thời: tắt route Worker trong Cloudflare dashboard, traffic
  trở lại pass-through 100%.
