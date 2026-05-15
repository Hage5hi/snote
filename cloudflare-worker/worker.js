/**
 * Cloudflare Worker — Prerender meta tags cho crawler không-JS.
 *
 * Triển khai trước syrin.online. Worker phát hiện User-Agent crawler
 * (LinkedIn, Slack, Facebook, Twitter, Discord, WhatsApp, Telegram...)
 * và trả HTML đã render sẵn meta tags theo từng note URL. Request từ
 * trình duyệt thường được pass-through tới Lovable hosting nguyên bản.
 *
 * Cấu hình cần (Environment Variables trong Cloudflare):
 *   - ORIGIN_HOST       = "snote.lovable.app"   (Lovable origin)
 *   - SUPABASE_PROJECT  = "onfzjmfjldsbthchssfr"
 *   - SUPABASE_ANON_KEY = "<anon key>"
 *   - SITE_URL          = "https://syrin.online"
 *
 * Route: gắn worker vào pattern  syrin.online/*  và  www.syrin.online/*
 */

const CRAWLER_UA = /(facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|Discordbot|WhatsApp|TelegramBot|Pinterest|redditbot|Applebot|Googlebot|bingbot|DuckDuckBot|YandexBot|Baiduspider|SkypeUriPreview|vkShare|W3C_Validator|Embedly|Iframely|nuzzel|outbrain|quora link preview|pinterestbot|XING-contenttabreceiver)/i;

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const TOKEN_RE = /^[a-zA-Z0-9_-]{8,128}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ua = request.headers.get("user-agent") ?? "";
    const isCrawler = CRAWLER_UA.test(ua);

    // Pass-through cho user thường + asset
    if (!isCrawler || isAssetPath(url.pathname)) {
      return passThrough(request, env);
    }

    // Phân tích route
    const route = parseRoute(url.pathname);
    if (!route) return passThrough(request, env);

    try {
      const meta = await fetchNoteMeta(route, env);
      return new Response(renderHtml(meta, url, env), {
        status: meta.found ? 200 : 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300, s-maxage=300",
          "x-prerendered": "1",
        },
      });
    } catch (err) {
      // Fallback an toàn
      return passThrough(request, env);
    }
  },
};

function isAssetPath(p) {
  return /\.(css|js|mjs|json|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|map|txt|xml|pdf)$/i.test(p);
}

function parseRoute(pathname) {
  if (pathname === "/" || pathname === "") return { kind: "home" };
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length === 2 && parts[0] === "s" && TOKEN_RE.test(parts[1])) {
    return { kind: "share", token: parts[1] };
  }
  if (parts.length === 1 && SLUG_RE.test(parts[0])) {
    return { kind: "note", slug: parts[0] };
  }
  return null;
}

async function fetchNoteMeta(route, env) {
  if (route.kind === "home") return { found: true, kind: "home" };
  const qs = route.kind === "share" ? `token=${route.token}` : `slug=${route.slug}`;
  const endpoint = `https://${env.SUPABASE_PROJECT}.functions.supabase.co/note-meta?${qs}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  });
  const data = await res.json();
  return { ...data, kind: route.kind };
}

async function passThrough(request, env) {
  const url = new URL(request.url);
  url.hostname = env.ORIGIN_HOST;
  return fetch(new Request(url, request));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(meta, url, env) {
  const site = env.SITE_URL.replace(/\/+$/, "");
  const canonical = `${site}${url.pathname}`;

  let title = "Syrin Notes — Markdown notes, realtime";
  let desc = "Markdown notes với realtime sync, mã hoá đầu cuối tuỳ chọn, không cần đăng ký.";
  let robots = "index,follow";
  let ogType = "website";

  if (meta.kind === "note" || meta.kind === "share") {
    if (meta.found) {
      title = `${meta.slug} — Syrin Notes`;
      ogType = "article";
      if (meta.isEncrypted) {
        desc = `Note "${meta.slug}" được mã hoá đầu cuối trên Syrin Notes. Cần khoá để mở.`;
        robots = "noindex,nofollow";
      } else if (meta.snippet) {
        desc = meta.snippet;
      } else {
        desc = `Note "${meta.slug}" trên Syrin Notes — markdown realtime, tự động lưu.`;
      }
    } else {
      title = "Note không tồn tại — Syrin Notes";
      desc = "Không tìm thấy note này.";
      robots = "noindex,nofollow";
    }
  }

  const T = escapeHtml(title);
  const D = escapeHtml(desc);
  const U = escapeHtml(canonical);

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${T}</title>
<meta name="description" content="${D}" />
<meta name="robots" content="${robots}" />
<link rel="canonical" href="${U}" />
<meta property="og:title" content="${T}" />
<meta property="og:description" content="${D}" />
<meta property="og:url" content="${U}" />
<meta property="og:type" content="${escapeHtml(ogType)}" />
<meta property="og:site_name" content="Syrin Notes" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${T}" />
<meta name="twitter:description" content="${D}" />
</head>
<body>
<h1>${T}</h1>
<p>${D}</p>
<p><a href="${U}">Mở trên Syrin Notes</a></p>
</body>
</html>`;
}
