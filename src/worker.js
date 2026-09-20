/**
 * Snippet Hub · Cloudflare Workers 版
 * D1 存储（条目 + 会话 + 登录限速），静态页面由 Workers Static Assets 托管
 * API 与 Node 版完全一致，前端无需修改
 */

const SESSION_COOKIE = 'sniphub_session';
const SESSION_TTL = 30 * 24 * 3600; // 秒
const SESSION_TTL_MS = SESSION_TTL * 1000;

const CORSLESS_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORSLESS_HEADERS, ...headers } });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(String(a ?? ''));
  const bb = enc.encode(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    /* ---------- 登录 / 登出 / 状态 ---------- */
    if (path === '/api/login' && request.method === 'POST') {
      const ip = clientIp(request);
      const now = Date.now();

      // 限速：10 分钟窗口内失败 >= 10 次则拒绝
      const cutoff = now - 10 * 60 * 1000;
      await env.DB.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(cutoff).run();
      const { count } = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM login_attempts WHERE ip = ? AND ts >= ?'
      ).bind(ip, cutoff).first();
      if (count >= 10) return json({ error: '尝试过于频繁，请 10 分钟后再试' }, 429);

      const body = await readJson(request);
      const okUser = safeEqual(body?.user, env.AUTH_USER);
      const okPass = safeEqual(body?.pass, env.AUTH_PASS);
      if (!(okUser && okPass)) {
        await env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(ip, now).run();
        return json({ error: '用户名或密码错误' }, 401);
      }

      const token = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '');
      await env.DB.prepare('INSERT INTO sessions (token, expires) VALUES (?, ?)')
        .bind(token, now + SESSION_TTL_MS).run();
      // 顺手清掉过期会话
      await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now).run();
      return json({ ok: true }, 200, {
        'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Secure; Path=/; Max-Age=${SESSION_TTL}; SameSite=Lax`,
      });
    }

    if (path === '/api/logout' && request.method === 'POST') {
      const token = getCookie(request, SESSION_COOKIE);
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return json({ ok: true }, 200, {
        'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax`,
      });
    }

    /* ---------- 会话校验 ---------- */
    const token = getCookie(request, SESSION_COOKIE);
    let authed = false;
    if (token) {
      const row = await env.DB.prepare('SELECT expires FROM sessions WHERE token = ?').bind(token).first();
      if (row && row.expires > Date.now()) authed = true;
    }
    if (path.startsWith('/api/') && !authed) return json({ error: '未登录' }, 401);

    if (path === '/api/me' && request.method === 'GET') return json({ user: env.AUTH_USER, authed });

    /* ---------- 条目 API（整包 JSON，与前端 save() 的全量同步一致） ---------- */
    if (path === '/api/items' && request.method === 'GET') {
      const row = await env.DB.prepare("SELECT value FROM kv WHERE key = 'items'").first();
      let items = [];
      try { items = JSON.parse(row?.value || '[]'); } catch { items = []; }
      return json(items);
    }

    if (path === '/api/items' && request.method === 'PUT') {
      const body = await readJson(request);
      if (!Array.isArray(body)) return json({ error: '格式错误' }, 400);
      const clean = body.filter(it => it && typeof it === 'object' && typeof it.id === 'string');
      const value = JSON.stringify(clean);
      await env.DB.prepare(
        "INSERT INTO kv (key, value) VALUES ('items', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind(value).run();
      return json({ ok: true, count: clean.length });
    }

    if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);

    /* ---------- 其余路径交给静态资源 ---------- */
    return env.ASSETS.fetch(request);
  },
};
