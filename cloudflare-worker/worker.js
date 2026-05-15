/**
 * Cloudflare Worker — Prerender meta tags cho crawler không-JS.
 *
 * Đặt trước syrin.online. Worker phát hiện User-Agent crawler
 * (LinkedIn, Slack, Facebook, Twitter, Discord, WhatsApp, Telegram...)
 * và trả HTML đã render sẵn meta tags theo từng note URL. Request từ
 * trình duyệt thường được pass-through tới Lovable hosting nguyên bản.
 *
 * Cấu hình cần (Environment Variables / Secrets trong Cloudflare):
 *   - ORIGIN_HOST        = "snote.lovable.app"   (Lovable origin)
 *   - SUPABASE_PROJECT   = "onfzjmfjldsbthchssfr"
 *   - SUPABASE_ANON_KEY  = <anon key>     (secret)
 *   - NOTE_META_SECRET   = <shared secret>  (secret) — phải khớp với
 *                         secret cùng tên trong Supabase Edge Function.
 *   - SITE_URL           = "https://syrin.online"
 *
 * Route: gắn worker vào pattern  syrin.online/*  và  www.syrin.online/*
 */

const CRAWLER_UA = /(facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|Discordbot|WhatsApp|TelegramBot|Pinterest|redditbot|Applebot|Googlebot|bingbot|DuckDuckBot|YandexBot|Baiduspider|SkypeUriPreview|vkShare|W3C_Validator|Embedly|Iframely|nuzzel|outbrain|quora link preview|pinterestbot|XING-contenttabreceiver)/i;

const SLUG_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const TOKEN_RE = /^[a-zA-Z0-9_-]{8,128}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Force www → apex để tránh duplicate canonical
    if (url.hostname === "www.syrin.online") {
      url.hostname = "syrin.online";
      return Response.redirect(url.toString(), 301);
    }

    const ua = request.headers.get("user-agent") ?? "";
    const isCrawler = CRAWLER_UA.test(ua);

    if (!isCrawler || isAssetPath(url.pathname)) {
      return passThrough(request, env);
    }

    // Chuẩn hoá pathname (strip trailing slash, lowercase host đã xong)
    const normalizedPath = normalizePath(url.pathname);
    if (normalizedPath !== url.pathname) {
      const redir = new URL(url);
      redir.pathname = normalizedPath;
      return Response.redirect(redir.toString(), 301);
    }

    const route = parseRoute(normalizedPath);
    if (!route) return passThrough(request, env);

    // Edge cache theo full URL
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const meta = await fetchNoteMeta(route, env);
      const html = renderHtml(meta, url, env);
      const isEncrypted = meta.kind !== "home" && meta.found && meta.isEncrypted;
      const cacheControl = isEncrypted
        ? "public, max-age=60, s-maxage=60"
        : meta.found
          ? "public, max-age=300, s-maxage=300, stale-while-revalidate=3600"
          : "public, max-age=60, s-maxage=60";

      const response = new Response(html, {
        status: meta.kind === "home" || meta.found ? 200 : 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": cacheControl,
          "x-prerendered": "1",
          "x-robots-tag": isEncrypted ? "noindex, nofollow" : "index, follow",
        },
      });

      // Lưu cache nền (chỉ cache 200)
      if (response.status === 200) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    } catch {
      return passThrough(request, env);
    }
  },
};

function isAssetPath(p) {
  return /\.(css|js|mjs|json|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|map|txt|xml|pdf)$/i.test(p);
}

function normalizePath(p) {
  if (!p || p === "/") return "/";
  // Decode + bỏ trailing slash + gộp slash kép
  let v = p.replace(/\/{2,}/g, "/");
  if (v.length > 1 && v.endsWith("/")) v = v.slice(0, -1);
  return v;
}

function parseRoute(pathname) {
  if (pathname === "/" || pathname === "") return { kind: "home" };
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length === 2 && parts[0] === "s" && TOKEN_RE.test(parts[1])) {
    return { kind: "share", token: parts[1] };
  }
  if (parts.length === 1) {
    let slug = parts[0];
    try { slug = decodeURIComponent(slug); } catch { /* ignore */ }
    if (SLUG_RE.test(slug)) return { kind: "note", slug };
  }
  return null;
}

async function fetchNoteMeta(route, env) {
  if (route.kind === "home") return { found: true, kind: "home" };
  const qs = route.kind === "share"
    ? `token=${encodeURIComponent(route.token)}`
    : `slug=${encodeURIComponent(route.slug)}`;
  const endpoint = `https://${env.SUPABASE_PROJECT}.functions.supabase.co/note-meta?${qs}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "x-meta-secret": env.NOTE_META_SECRET ?? "",
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
  let robots = "index, follow";
  let ogType = "website";

  if (meta.kind === "note" || meta.kind === "share") {
    if (meta.found) {
      title = `${meta.slug} — Syrin Notes`;
      ogType = "article";
      if (meta.isEncrypted) {
        desc = `Note "${meta.slug}" được mã hoá đầu cuối trên Syrin Notes. Cần khoá để mở.`;
        // Note mã hoá: chặn mọi index/cache/snippet/archive
        robots = "noindex, nofollow, noarchive, nosnippet, noimageindex, nocache";
      } else if (meta.snippet) {
        desc = meta.snippet;
      } else {
        desc = `Note "${meta.slug}" trên Syrin Notes — markdown realtime, tự động lưu.`;
      }
    } else {
      title = "Note không tồn tại — Syrin Notes";
      desc = "Không tìm thấy note này.";
      robots = "noindex, nofollow";
    }
  }

  const T = escapeHtml(title);
  const D = escapeHtml(desc);
  const U = escapeHtml(canonical);
  const R = escapeHtml(robots);

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${T}</title>
<meta name="description" content="${D}" />
<meta name="robots" content="${R}" />
<meta name="googlebot" content="${R}" />
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
