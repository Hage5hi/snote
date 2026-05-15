# Cloudflare Worker — Prerender meta cho crawler

Worker đặt **trước** `syrin.online` để render HTML với `og:*`, `twitter:*`,
`canonical`, `robots` theo từng note URL cho crawler không chạy JavaScript
(LinkedIn, Slack, Facebook, Discord, WhatsApp, Telegram, Twitter…).

User thật và Googlebot vẫn được pass-through tới Lovable hosting và nhận
SPA gốc với `react-helmet-async`.

## Cách hoạt động

```
       crawler? ──yes──▶ fetch /functions/v1/note-meta ──▶ render HTML <head>
request──┤
       └─no──▶ proxy tới snote.lovable.app (origin Lovable)
```

Phát hiện crawler bằng User-Agent (regex trong `worker.js`).

## Triển khai

1. **Trỏ domain qua Cloudflare**
   - Thêm `syrin.online` vào Cloudflare account của bạn.
   - Cập nhật nameserver tại registrar theo hướng dẫn Cloudflare.
   - Trong Cloudflare DNS: tạo record `CNAME syrin.online → snote.lovable.app`
     (hoặc giữ nguyên CNAME hiện có), bật proxy (orange cloud).
   - Tương tự cho `www.syrin.online`.

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

4. **Set secret cho anon key** (publishable, an toàn nhưng nên qua secret):
   ```bash
   wrangler secret put SUPABASE_ANON_KEY
   # paste anon key khi được hỏi
   ```
   Anon key hiện tại của project có sẵn trong `src/integrations/supabase/client.ts`.

5. **Deploy**
   ```bash
   wrangler deploy
   ```

## Kiểm tra

Sau khi deploy, test với UA crawler:

```bash
# Note bình thường
curl -A "facebookexternalhit/1.1" https://syrin.online/my-note-slug -i | head -40

# Share link
curl -A "Slackbot-LinkExpanding 1.0" https://syrin.online/s/<token> -i | head -40

# Trình duyệt thường (phải pass-through, không có x-prerendered)
curl -A "Mozilla/5.0" https://syrin.online/my-note-slug -I
```

Hoặc dùng debugger chính chủ:
- LinkedIn: <https://www.linkedin.com/post-inspector/>
- Facebook: <https://developers.facebook.com/tools/debug/>
- Twitter/X: <https://cards-dev.twitter.com/validator>
- Slack: paste link vào kênh test.

## Endpoint Edge Function

Worker gọi tới Supabase Edge Function `note-meta` (đã deploy tự động qua Lovable):

```
GET https://onfzjmfjldsbthchssfr.functions.supabase.co/note-meta?slug=<slug>
GET https://onfzjmfjldsbthchssfr.functions.supabase.co/note-meta?token=<share-token>
```

Trả JSON `{ found, slug, isEncrypted, snippet, charCount, tags, updatedAt }`.
Note mã hoá → không trả `snippet` và Worker tự set `robots=noindex`.

## Bảo trì

- Thêm crawler UA mới: cập nhật regex `CRAWLER_UA` trong `worker.js`.
- Đổi domain: cập nhật `SITE_URL` và `routes` trong `wrangler.toml`.
- Bypass tạm thời: tắt route Worker trong Cloudflare dashboard, traffic
  trở lại pass-through 100%.
