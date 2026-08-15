/*
 * ============ Cloudflare Pages Function：图标自动发现接口 ============
 * 部署后接口地址：https://<你的项目名>.pages.dev/api/icon?url=<编码后的网址>
 * 返回 JSON：{ "icon": "网站真实图标完整地址" }
 *
 * 部署方式（二选一）：
 *   A. Git 部署：如果你已用 Git 仓库接入 Cloudflare Pages，把本文件连同
 *      functions/ 目录一起提交推送即可自动部署。
 *   B. wrangler 命令行（无 Git 时用）：
 *      npm install -g wrangler
 *      npx wrangler login
 *      npx wrangler pages deploy . --project-name=<你的项目名>
 *
 * 接入 index.html：把接口地址填入 ICON_FINDER_API 常量：
 *   const ICON_FINDER_API = 'https://<你的项目名>.pages.dev/api/icon';
 * ==============================================================
 */

export async function onRequestGet({ request }) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url');
  if (!target || !/^https?:\/\//i.test(target)) {
    return json({ icon: '', error: 'missing or invalid url param' }, 400, corsHeaders);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    let icon = extractIcon(html, target);
    if (!icon) {
      // 通用解析失败：部分站点（如 platform.deepseek.com）对数据中心 IP
      // 返回不含 <link rel="icon"> 的简化页面 → 查已知站点图标映射表兜底
      icon = knownIconFor(target);
    }
    return json({ icon }, 200, corsHeaders);
  } catch (e) {
    return json({ icon: '', error: 'fetch failed' }, 200, corsHeaders);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** 从 HTML 中提取图标地址，优先级：apple-touch-icon → shortcut icon → icon → mask-icon */
function extractIcon(html, pageUrl) {
  if (!html) return '';

  const patterns = [
    /<link[^>]+rel=["']?apple-touch-icon[^>]*>/gi,
    /<link[^>]+rel=["']?(?:shortcut\s+)?icon[^>]*>/gi,
    /<link[^>]+rel=["']?mask-icon[^>]*>/gi,
  ];

  let href = '';
  for (const re of patterns) {
    const matches = html.match(re);
    if (!matches) continue;
    for (const tag of matches) {
      const hm = tag.match(/href=["']([^"']+)["']/i);
      if (hm && hm[1]) { href = hm[1].trim(); break; }
    }
    if (href) break;
  }

  if (!href) return '';
  if (/^data:/i.test(href)) return href;                       // data URI 直接返回
  try {
    return new URL(href, pageUrl).href;                        // 相对路径补全为绝对地址
  } catch {
    return '';
  }
}

/**
 * 已知站点图标映射表（兜底方案）。
 * 部分站点对服务器/数据中心 IP 返回不含 <link rel="icon"> 的简化页面，
 * 通用解析拿不到图标；这些站点的真实图标地址在此登记，按 hostname 匹配。
 */
const KNOWN_ICONS = {
  'platform.deepseek.com': 'https://fe-static.deepseek.com/platform/favicon.svg',
};

/** 按目标网址 hostname 查询已知站点图标，未登记返回空字符串 */
function knownIconFor(target) {
  if (!target) return '';
  try {
    const host = new URL(target).hostname.toLowerCase();
    return KNOWN_ICONS[host] || '';
  } catch {
    return '';
  }
}
