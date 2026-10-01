// 灵感匣 · 轻量后端
// 提供：图片上传（/api/upload）、链接元数据抓取（/api/preview）、
//       外链主图代理（/api/img）、静态资源（/uploads）
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 统一 UA：不少平台对异常 UA 直接返回空页 / 登录页，导致抓不到主图
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 依次尝试的 UA：桌面浏览器 → 社交爬虫 → 微信内置浏览器。
// 很多站点会专门给社交爬虫放行 OG 标签，这三种覆盖绝大多数中文平台。
const UAS = [
  UA,
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002832) NetType/WIFI Language/zh_CN",
];

// 元数据内存缓存：同一链接 10 分钟内不重复抓取
const metaCache = new Map();
const META_TTL = 10 * 60 * 1000;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)
      ? ext
      : ".jpg";
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
});

// 上传图片：返回可访问的 URL（相对路径，配合 Vite 代理 /uploads）
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.use("/uploads", express.static(UPLOAD_DIR));

/* ============================================================
   链接解析
   ============================================================ */

// 解码 meta 标签里的 HTML 实体（如 og:image 常见的 &amp;）
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&amp;/g, "&");
}

// 抓取 meta 属性（兼容 content 在前 / 在后两种写法）
function pick(html, prop) {
  const a =
    html.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
        "i"
      )
    ) ||
    html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
        "i"
      )
    );
  return a ? a[1].trim() : null;
}

// 依次尝试多条正则，返回首个捕获组
function firstMatch(html, regexes) {
  for (const re of regexes) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// 把可能是相对路径的图片地址解析为绝对地址
function absUrl(u, base) {
  if (!u) return null;
  try {
    if (u.startsWith("//")) return "https:" + u;
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

// 一张图是否像「可用的主图」（过滤图标 / 头像 / 占位 / 埋点）
function looksLikeCover(u) {
  if (!u) return false;
  if (/^data:/i.test(u)) return false;
  // 只对路径做判断，避免 query 里恰好含关键词造成误杀
  let pathPart = u;
  try {
    pathPart = new URL(u).pathname;
  } catch {
    /* 相对地址，直接用原串 */
  }
  if (/(sprite|favicon|logo|icon|avatar|placeholder|blank|spacer|1x1|pixel)/i.test(pathPart))
    return false;
  return true;
}

// 主图提取：OG → Twitter → link image_src / itemprop → JSON-LD → 首张正文大图
function extractImage(html, base) {
  let raw =
    pick(html, "og:image") ||
    pick(html, "og:image:secure_url") ||
    pick(html, "og:image:url") ||
    pick(html, "twitter:image") ||
    pick(html, "twitter:image:src") ||
    pick(html, "image");

  if (!raw) {
    raw = firstMatch(html, [
      /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
      /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']image_src["']/i,
      /itemprop=["']image["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*itemprop=["']image["']/i,
    ]);
  }

  // JSON-LD（小红书 / 微博等页面常见 script[type=application/ld+json]）
  if (!raw) {
    const ldRe = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = ldRe.exec(html))) {
      const seg = m[1];
      const im = seg.match(/"image"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)")/i);
      const cand = im && (im[1] || im[2]);
      if (cand) {
        raw = cand.replace(/\\\//g, "/");
        break;
      }
    }
  }

  // 兜底：页面里第一张看着像正文图的 <img>
  if (!raw) {
    const imgRe = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi;
    let m;
    while ((m = imgRe.exec(html))) {
      const src = m[1];
      if (!/^(https?:)?\/\//i.test(src)) continue;
      if (!looksLikeCover(src)) continue;
      raw = src;
      break;
    }
  }

  // 关键：先解码 HTML 实体。og:image 常带 &amp;（如 ...?a=1&amp;b=2），
  // 不解码会得到无效 URL，图片在卡片上必然加载失败。
  raw = decodeEntities(raw);

  const abs = absUrl(raw, base);
  if (!abs || !looksLikeCover(abs)) return null;
  // 统一升到 https，避免 https 页面里图片被浏览器当混合内容拦截
  return abs.replace(/^http:\/\//i, "https://");
}

// 解析 HTML 为元数据
function parseMeta(html, base) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    finalUrl: base,
    title: decodeEntities(
      pick(html, "og:title") ||
        pick(html, "twitter:title") ||
        (titleMatch ? titleMatch[1].trim() : null)
    ),
    image: extractImage(html, base),
    description: decodeEntities(
      pick(html, "og:description") ||
        pick(html, "twitter:description") ||
        pick(html, "description")
    ),
    siteName: decodeEntities(pick(html, "og:site_name")),
  };
}

// 抓取页面（单次，带超时）
async function fetchPage(target, ua) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(target, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const html = await resp.text();
    return { html, base: resp.url || target };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMeta(target) {
  const cached = metaCache.get(target);
  if (cached && Date.now() - cached.at < META_TTL) return cached.data;

  // 依次尝试多种 UA：不少站点只对「社交爬虫 / 站内浏览器」放行 OG 标签，
  // 抓到主图就立即采用，避免无意义的重试开销。
  let best = null;
  let lastErr = null;
  for (const ua of UAS) {
    try {
      const { html, base } = await fetchPage(target, ua);
      const meta = parseMeta(html, base);
      if (!best) best = meta;
      if (meta.image) {
        best = meta;
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!best) throw lastErr || new Error("fetch failed");
  metaCache.set(target, { at: Date.now(), data: best });
  return best;
}

app.get("/api/preview", async (req, res) => {
  const target = req.query.url;
  if (!target || !/^https?:\/\//i.test(target)) {
    return res.status(400).json({ error: "invalid url" });
  }
  try {
    const meta = await fetchMeta(target);
    res.json(meta);
  } catch (e) {
    res.status(502).json({ error: "fetch failed", detail: String(e.message || e) });
  }
});

/* ============================================================
   外链主图代理
   原因：小红书 / 微博 / B站 等图床校验 Referer，浏览器直连必然裂图；
        且部分图片为 http，https 页面下会被当混合内容拦截。
   做法：服务端带伪装 Referer + UA 取图后回传，前端只看到同源地址。
   ============================================================ */
app.get("/api/img", async (req, res) => {
  const target = String(req.query.url || "");
  const ref = String(req.query.ref || "");
  if (!/^https?:\/\//i.test(target)) return res.status(400).end();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const u = new URL(target);
    // 伪装 Referer：优先用原笔记页域名，其次退回图片自身域名
    let referer = `${u.protocol}//${u.host}/`;
    if (/^https?:\/\//i.test(ref)) {
      try {
        const r = new URL(ref);
        referer = `${r.protocol}//${r.host}/`;
      } catch {
        /* 忽略非法 ref */
      }
    }

    const resp = await fetch(target, {
      headers: {
        "User-Agent": UA,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: referer,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });

    if (!resp.ok) return res.status(502).end();
    const ct = resp.headers.get("content-type") || "";
    if (!/^image\//i.test(ct)) return res.status(415).end();

    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length || buf.length > 10 * 1024 * 1024) return res.status(413).end();

    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch {
    res.status(502).end();
  } finally {
    clearTimeout(timer);
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[inspiration-api] http://localhost:${PORT}`);
});
