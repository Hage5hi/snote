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

// Mở rộng UA: thêm iMessage/Apple, TikTok, Zalo, LINE, Viber, KakaoTalk,
// Snapchat, Mastodon, Bluesky, Threads, Notion, Trello, Asana, Microsoft
// Teams, Outlook/Office, Google-Read-Aloud, Google-Site-Verification,
// PetalBot, Yeti (Naver), SeznamBot, Qwantify, MojeekBot, AhrefsBot,
// SemrushBot, archive.org_bot, ia_archiver, Snapcrawler, Tumblr, Flipboard.
const CRAWLER_UA = /(facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|Discordbot|WhatsApp|TelegramBot|Pinterest|pinterestbot|redditbot|Applebot|Googlebot|Google-Read-Aloud|Google-Site-Verification|Google-InspectionTool|bingbot|DuckDuckBot|YandexBot|Baiduspider|SkypeUriPreview|vkShare|W3C_Validator|Embedly|Iframely|nuzzel|outbrain|quora link preview|XING-contenttabreceiver|TikTokBot|Bytespider|Snapchat|SnapchatAds|Snapcrawler|Mastodon|Pleroma|Misskey|Threads|Bluesky|Notionbot|Trello|Asana|MicrosoftPreview|Teams|Outlook|Office|Zalo|LINE|Viber|KakaoTalk|iMessageLinkPreview|MetaInspector|Tumblr|Flipboard|PetalBot|Yeti|SeznamBot|Qwantify|MojeekBot|AhrefsBot|SemrushBot|archive\.org_bot|ia_archiver|YisouSpider|Sogou|360Spider|MJ12bot|DotBot|HeadlessChrome)/i;

const SLUG_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const TOKEN_RE = /^[a-zA-Z0-9_-]{8,128}$/;
const SHARE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";

// Rate limit (in-memory per-isolate). Token bucket đơn giản.
// Ghi chú: Mỗi colo/isolate giữ state riêng, không 100% chính xác toàn cầu,
// nhưng đủ chặn spike. Để chính xác hơn dùng Durable Objects / KV.
//
// Hai tầng giới hạn (đều phải pass):
//   1. Per-IP:        chặn 1 client spam.
//   2. Per-(IP,bot):  mỗi nhóm bot có hạn mức riêng cho cùng 1 IP, để 1 bot
//                     đơn lẻ không "xơi" hết quota chung và bóp các bot khác.
const RL_WINDOW_MS = 60_000;        // cửa sổ 60s
const RL_IP_MAX = 120;              // tổng / IP / 60s
const RL_BOT_DEFAULT_MAX = 30;      // mỗi (IP, bot) / 60s
const RL_BOT_MAX = {                // override theo nhóm bot
  facebook: 40, slack: 40, linkedin: 30, twitter: 30, discord: 30,
  whatsapp: 20, telegram: 20, google: 60, bing: 40, apple: 30,
  tiktok: 20, reddit: 20, pinterest: 20, yandex: 20, baidu: 20,
  zalo: 20, line: 20, viber: 20, kakao: 20, mastodon: 20,
  bluesky: 20, threads: 20, microsoft: 30, seo: 10, archive: 10,
  other: 20,
};

// Map UA → nhóm bot (thứ tự quan trọng, match đầu tiên thắng).
const BOT_GROUPS = [
  ["facebook",  /facebookexternalhit|facebot|metainspector/i],
  ["slack",     /slack/i],
  ["linkedin",  /linkedinbot/i],
  ["twitter",   /twitterbot/i],
  ["discord",   /discordbot/i],
  ["whatsapp",  /whatsapp/i],
  ["telegram",  /telegrambot/i],
  ["apple",     /applebot|imessagelinkpreview/i],
  ["tiktok",    /tiktokbot|bytespider/i],
  ["google",    /googlebot|google-(read-aloud|site-verification|inspectiontool)/i],
  ["bing",      /bingbot|microsoftpreview/i],
  ["microsoft", /teams|outlook|office/i],
  ["yandex",    /yandexbot/i],
  ["baidu",     /baiduspider/i],
  ["reddit",    /redditbot/i],
  ["pinterest", /pinterest/i],
  ["zalo",      /zalo/i],
  ["line",      /\bline\b/i],
  ["viber",     /viber/i],
  ["kakao",     /kakaotalk/i],
  ["mastodon",  /mastodon|pleroma|misskey/i],
  ["bluesky",   /bluesky/i],
  ["threads",   /threads/i],
  ["seo",       /ahrefsbot|semrushbot|mj12bot|dotbot|petalbot/i],
  ["archive",   /archive\.org_bot|ia_archiver/i],
];

function botGroup(ua) {
  for (const [name, re] of BOT_GROUPS) if (re.test(ua)) return name;
  return "other";
}

const rlBuckets = new Map();        // key -> { count, resetAt }

function takeBucket(key, limit) {
  const now = Date.now();
  const b = rlBuckets.get(key);
  if (!b || now >= b.resetAt) {
    rlBuckets.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: limit - b.count, retryAfter: 0 };
}

// Dọn map định kỳ để tránh phình bộ nhớ isolate.
function gcBuckets() {
  if (rlBuckets.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of rlBuckets) if (now >= v.resetAt) rlBuckets.delete(k);
}

function rateLimit(ip, ua) {
  gcBuckets();
  const group = botGroup(ua);
  const botMax = RL_BOT_MAX[group] ?? RL_BOT_DEFAULT_MAX;
  const ipRes  = takeBucket(`ip:${ip}`, RL_IP_MAX);
  const botRes = takeBucket(`bot:${ip}|${group}`, botMax);
  const ok = ipRes.ok && botRes.ok;
  const reason = !ipRes.ok ? "ip" : !botRes.ok ? "bot" : null;
  const retryAfter = Math.max(ipRes.retryAfter, botRes.retryAfter);
  const remaining = Math.min(ipRes.remaining, botRes.remaining);
  return { ok, remaining, retryAfter, group, reason };
}

function logEvent(env, level, msg, fields = {}) {
  // Cloudflare tự thu console.* vào Workers Logs / Logpush.
  const payload = { ts: new Date().toISOString(), level, msg, ...fields };
  try { console.log(JSON.stringify(payload)); } catch { /* ignore */ }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const ua = request.headers.get("user-agent") ?? "";
    const isCrawler = CRAWLER_UA.test(ua);

    if (url.pathname === "/robots.txt") {
      if (url.hostname === "www.syrin.online") {
        url.hostname = "syrin.online";
        return Response.redirect(url.toString(), 301);
      }
      const body = renderRobotsTxt(env);
      const etag = etagOf(body);
      if (matchesEtag(request, etag)) {
        return new Response(null, {
          status: 304,
          headers: {
            etag,
            "cache-control": "public, max-age=300, s-maxage=300, must-revalidate",
            vary: "User-Agent",
          },
        });
      }
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=300, s-maxage=300, must-revalidate",
          etag,
          vary: "User-Agent",
        },
      });
    }

    if (!isCrawler || isAssetPath(url.pathname)) {
      if (url.hostname === "www.syrin.online") {
        url.hostname = "syrin.online";
        return Response.redirect(url.toString(), 301);
      }
      return passThrough(request, env);
    }

    // Rate limit chỉ áp dụng cho nhánh crawler (đã rẽ vào prerender).
    const rl = rateLimit(ip, ua);
    if (!rl.ok) {
      logEvent(env, "warn", "rate_limited", {
        group: rl.group, scope: rl.reason,
        retryAfter: rl.retryAfter,
      });
      return new Response("Too Many Requests", {
        status: 429,
        headers: {
          "retry-after": String(rl.retryAfter),
          "cache-control": "no-store",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-scope": rl.reason ?? "",
          "x-bot-group": rl.group,
        },
      });
    }

    // Resolve share routes before redirects, cache access, or metadata lookup.
    // Even a trailing slash must not echo the capability-bearing path back in
    // a Location header or create a second cache key.
    const normalizedPath = normalizePath(url.pathname);
    const route = parseRoute(normalizedPath);
    if (route?.kind === "share") {
      logEvent(env, "info", "prerender", {
        kind: "share", status: 200, group: rl.group,
      });
      return renderGenericShareHtml();
    }

    // Canonicalize non-share requests only after capability-bearing share
    // routes have been contained. A redirect would echo the token in Location.
    if (url.hostname === "www.syrin.online") {
      url.hostname = "syrin.online";
      return Response.redirect(url.toString(), 301);
    }

    // Chuẩn hoá pathname (strip trailing slash, lowercase host đã xong)
    if (normalizedPath !== url.pathname) {
      const redir = new URL(url);
      redir.pathname = normalizedPath;
      return Response.redirect(redir.toString(), 301);
    }

    if (!route) return passThrough(request, env);

    // Edge cache theo full URL
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      logEvent(env, "info", "cache_hit", { kind: route.kind, group: rl.group });
      return cached;
    }

    const t0 = Date.now();
    try {
      const meta = await fetchNoteMeta(route, env);
      const html = renderHtml(meta, url, env);
      const isEncrypted = meta.kind !== "home" && meta.found && meta.isEncrypted;
      const cacheControl = isEncrypted
        ? "public, max-age=60, s-maxage=60, must-revalidate"
        : meta.found
          ? "public, max-age=300, s-maxage=300, stale-while-revalidate=3600, must-revalidate"
          : "public, max-age=60, s-maxage=60, must-revalidate";

      const status = meta.kind === "home" || meta.found ? 200 : 404;
      const etag = etagOf(html);

      // Conditional GET: trả 304 nếu client/scraper đã có bản cũ còn hợp lệ
      if (status === 200 && matchesEtag(request, etag)) {
        return new Response(null, {
          status: 304,
          headers: {
            etag,
            "cache-control": cacheControl,
            "x-prerendered": "1",
            "x-robots-tag": isEncrypted ? "noindex, nofollow" : "index, follow",
            vary: "User-Agent",
          },
        });
      }

      const response = new Response(html, {
        status,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": cacheControl,
          etag,
          "x-prerendered": "1",
          "x-robots-tag": isEncrypted ? "noindex, nofollow" : "index, follow",
          "x-ratelimit-remaining": String(rl.remaining),
          vary: "User-Agent",
        },
      });

      logEvent(env, "info", "prerender", {
        kind: route.kind, group: rl.group,
        status, found: !!meta.found, encrypted: !!isEncrypted,
        ms: Date.now() - t0,
      });

      // Lưu cache nền (chỉ cache 200)
      if (response.status === 200) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    } catch (err) {
      logEvent(env, "error", "prerender_failed", {
        kind: route.kind,
        errorName: err instanceof Error ? err.name : "unknown",
        ms: Date.now() - t0,
      });
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
  if (parts.length === 2) {
    let prefix;
    let token;
    try {
      prefix = decodeURIComponent(parts[0]);
      token = decodeURIComponent(parts[1]);
    } catch {
      return null;
    }
    if (prefix.toLowerCase() === "s" && TOKEN_RE.test(token)) {
      return { kind: "share" };
    }
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
  if (route.kind !== "note") throw new TypeError("metadata route must be home or note");
  const qs = `slug=${encodeURIComponent(route.slug)}`;
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

  if (meta.kind === "note") {
    if (meta.found) {
      title = `Syrin Notes — /${meta.slug}`;
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

function renderGenericShareHtml() {
  const title = "Shared note — Syrin Notes";
  const description = "Open a private, revocable shared note on Syrin Notes.";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta name="robots" content="${SHARE_ROBOTS}" />
<meta name="googlebot" content="${SHARE_ROBOTS}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Syrin Notes" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
</head>
<body>
<h1>${title}</h1>
<p>${description}</p>
<p><a href="/">Open Syrin Notes</a></p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "cdn-cache-control": "no-store",
      "x-robots-tag": SHARE_ROBOTS,
      vary: "User-Agent",
    },
  });
}

function renderRobotsTxt(env) {
  const siteUrl = (env.SITE_URL || "https://syrin.online").replace(/\/+$/, "");
  return `User-agent: facebookexternalhit
Allow: /

User-agent: Facebot
Allow: /

User-agent: meta-externalagent
Allow: /

User-agent: Googlebot
Allow: /
Disallow: /note

User-agent: Bingbot
Allow: /
Disallow: /note

User-agent: Twitterbot
Allow: /
Disallow: /note

User-agent: *
Allow: /
Disallow: /note

Sitemap: ${siteUrl}/sitemap.xml
`;
}

// FNV-1a 32-bit → ETag yếu, đủ để so sánh body.
function etagOf(input) {
  const s = typeof input === "string" ? input : String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `W/"${h.toString(16)}-${s.length.toString(16)}"`;
}

function matchesEtag(request, etag) {
  const inm = request.headers.get("if-none-match");
  if (!inm) return false;
  // Hỗ trợ list comma-separated và '*'
  if (inm.trim() === "*") return true;
  const bare = etag.replace(/^W\//, "");
  return inm.split(",").some((t) => {
    const v = t.trim().replace(/^W\//, "");
    return v === bare;
  });
}
