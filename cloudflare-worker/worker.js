/**
 * Cloudflare Worker — containment cho URL riêng tư và prerender public shell.
 *
 * Đặt trước syrin.online. Worker phát hiện User-Agent crawler
 * (LinkedIn, Slack, Facebook, Twitter, Discord, WhatsApp, Telegram...). URL
 * note/share luôn nhận HTML generic, không cache và không index; chỉ public
 * shell được prerender metadata. Request từ trình duyệt thường được
 * pass-through tới Lovable hosting nguyên bản mà không redirect URL chứa quyền.
 *
 * Cấu hình cần (Environment Variables / Secrets trong Cloudflare):
 *   - ORIGIN_HOST        = "snote.lovable.app"   (Lovable origin)
 *   - SITE_URL           = "https://note.syrin.online"
 *
 * Route: gắn worker vào các pattern note.syrin.online/*, syrin.online/*
 * và www.syrin.online/*. Mọi hostname share công khai phải đi qua Worker
 * trước khi request /s/* có thể tới origin.
 */

// Mở rộng UA: thêm iMessage/Apple, TikTok, Zalo, LINE, Viber, KakaoTalk,
// Snapchat, Mastodon, Bluesky, Threads, Notion, Trello, Asana, Microsoft
// Teams, Outlook/Office, Google-Read-Aloud, Google-Site-Verification,
// PetalBot, Yeti (Naver), SeznamBot, Qwantify, MojeekBot, AhrefsBot,
// SemrushBot, archive.org_bot, ia_archiver, Snapcrawler, Tumblr, Flipboard.
const CRAWLER_UA = /(facebookexternalhit|Facebot|meta-externalagent|meta-externalfetcher|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|Discordbot|WhatsApp|TelegramBot|Pinterest|pinterestbot|redditbot|Applebot|Googlebot|Google-Read-Aloud|Google-Site-Verification|Google-InspectionTool|bingbot|DuckDuckBot|YandexBot|Baiduspider|SkypeUriPreview|vkShare|W3C_Validator|Embedly|Iframely|nuzzel|outbrain|quora link preview|XING-contenttabreceiver|TikTokBot|Bytespider|Snapchat|SnapchatAds|Snapcrawler|Mastodon|Pleroma|Misskey|Threads|Bluesky|Notionbot|Trello|Asana|MicrosoftPreview|Teams|Outlook|Office|Zalo|LINE|Viber|KakaoTalk|iMessageLinkPreview|MetaInspector|Tumblr|Flipboard|PetalBot|Yeti|SeznamBot|Qwantify|MojeekBot|AhrefsBot|SemrushBot|archive\.org_bot|ia_archiver|YisouSpider|Sogou|360Spider|MJ12bot|DotBot|HeadlessChrome)/i;

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const RAW_NOTE_RE = /^([a-zA-Z0-9_-]{1,64})\.md$/i;
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
  ["facebook",  /facebookexternalhit|facebot|meta-external(agent|fetcher)|metainspector/i],
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

    // Classify capability-bearing share paths before asset passthrough or host
    // redirects. A token may legitimately look like a filename or be followed
    // by nested path data, and neither case may reach the origin.
    const normalizedPath = normalizePath(url.pathname);
    const route = parseRoute(url.pathname);
    if (isCrawler && route?.kind === "share") {
      logEvent(env, "info", "prerender", {
        kind: "share", status: 200,
      });
      return renderGenericShareHtml();
    }
    // A legacy note slug is still an edit credential until the capability
    // cutover. Never read a content-bearing cache or metadata endpoint for a
    // crawler: a cached plaintext preview could survive a later lock/revoke.
    if (isCrawler && route?.kind === "note") {
      logEvent(env, "info", "prerender", {
        kind: "note", status: 200,
      });
      return renderGenericNoteHtml();
    }

    if (!isCrawler || isAssetPath(url.pathname)) {
      // Legacy note locators and share paths are credentials until cutover.
      // Passing them through avoids copying the raw path into Location and
      // another round of proxy/browser logs. Public routes may still redirect.
      if (
        url.hostname === "www.syrin.online"
        && route?.kind !== "share"
        && route?.kind !== "note"
      ) {
        url.hostname = "syrin.online";
        return Response.redirect(url.toString(), 301);
      }
      return passThrough(
        request,
        env,
        route?.kind === "share" || route?.kind === "note",
        route?.kind === "share" || route?.kind === "note" ? route.kind : null,
      );
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

    // Canonicalize only after every credential-bearing route has been
    // contained. A redirect would echo that credential in Location.
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
  pathname = normalizeContainmentPath(pathname);
  if (traversesShareRoute(pathname)) {
    // Containment is deliberately independent of the legacy token regex.
    // Once resolution reaches `/s/<token>`, later traversal cannot erase the
    // sensitivity of the raw path or let it reach redirects, caches, or logs.
    return { kind: "share" };
  }
  if (pathname === "/" || pathname === "") return { kind: "home" };
  pathname = resolveContainmentDotSegments(pathname);
  if (pathname === "/" || pathname === "") return { kind: "home" };
  // `/privacy` is an explicit public SPA route, not a legacy note locator.
  // Keep it crawlable and outside the no-store/noindex credential boundary.
  if (pathname.toLowerCase() === "/privacy") return null;
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length === 1) {
    let slug = parts[0];
    try { slug = decodeURIComponent(slug); } catch { /* ignore */ }
    if (SLUG_RE.test(slug)) return { kind: "note", slug };
    const rawNote = slug.match(RAW_NOTE_RE);
    if (rawNote) return { kind: "note", slug: rawNote[1] };
  }
  return null;
}

function normalizeContainmentPath(pathname) {
  let value = pathname || "/";

  // Decode a bounded number of mixed encodings, then collapse arbitrarily
  // repeated standard encodings of path separators. This normalization is
  // only for security classification; the raw path is never logged or echoed.
  for (let pass = 0; pass < 8; pass += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      break;
    }
    if (decoded === value) break;
    value = decoded;
  }
  value = value.replace(/%(?:25)*(?:2f|5c)/gi, "/");
  value = value.replace(/%(?:25)*2e/gi, ".");
  value = value.replace(/\\/g, "/");
  return normalizePath(value);
}

function traversesShareRoute(pathname) {
  const segments = [];
  for (const segment of pathname.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
    if (segments.length >= 2 && isSharePrefix(segments[0])) return true;
  }
  return false;
}

function resolveContainmentDotSegments(pathname) {
  const segments = [];
  for (const segment of pathname.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function isSharePrefix(value) {
  // Match s/S plus any number of standard re-encodings of %73/%53, e.g.
  // %73, %2573, %252573. This stays linear for hostile input.
  return value.toLowerCase() === "s" || /^%(?:25)*(?:53|73)$/i.test(value);
}

async function fetchNoteMeta(route) {
  if (route.kind === "home") return { found: true, kind: "home" };
  throw new TypeError("private metadata lookup is disabled");
}

async function passThrough(
  request,
  env,
  privateRoute = false,
  privateRouteKind = null,
) {
  const url = new URL(request.url);
  url.hostname = env.ORIGIN_HOST;
  if (privateRouteKind === "share") {
    // The SPA migrates the legacy token into the URL fragment before routing.
    // Fragments never reach this worker, so the origin only needs the generic
    // compatibility shell and must not receive the raw credential path/query.
    url.pathname = "/s";
    url.search = "";
  } else if (privateRouteKind === "note") {
    // A legacy slug is still a credential. The root document is the same SPA
    // shell, while the outer browser URL remains unchanged for BrowserRouter.
    url.pathname = "/";
    url.search = "";
  }
  const response = await fetch(new Request(url, request));
  if (!privateRoute) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("cdn-cache-control", "no-store");
  headers.set("x-robots-tag", SHARE_ROBOTS);
  headers.set("referrer-policy", "no-referrer");
  headers.delete("etag");
  headers.delete("last-modified");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
  return renderGenericPrivateHtml(
    "Shared note — Syrin Notes",
    "Open a private, revocable shared note on Syrin Notes.",
  );
}

function renderGenericNoteHtml() {
  return renderGenericPrivateHtml(
    "Private note — Syrin Notes",
    "Open a private note on Syrin Notes.",
  );
}

function renderGenericPrivateHtml(title, description) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="referrer" content="no-referrer" />
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
      "referrer-policy": "no-referrer",
      vary: "User-Agent",
    },
  });
}

function renderRobotsTxt(env) {
  const siteUrl = (env.SITE_URL || "https://note.syrin.online").replace(/\/+$/, "");
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
