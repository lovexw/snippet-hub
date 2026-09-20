/**
 * Snippet Hub · 服务器版
 * 零依赖 Node.js 服务端：静态托管 + 账号密码登录 + JSON 文件存储
 * 需要 Node.js >= 18
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8321;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');

const SESSION_COOKIE = 'sniphub_session';
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 天

/* ---------- 初始化数据目录与账号 ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadCredentials() {
  if (process.env.AUTH_USER && process.env.AUTH_PASS) {
    return { user: process.env.AUTH_USER, pass: process.env.AUTH_PASS };
  }
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (c.user && c.pass) return c;
    } catch { /* 损坏则重建 */ }
  }
  const pass = crypto.randomBytes(9).toString('base64url');
  const c = { user: 'admin', pass };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
  console.log('==============================================');
  console.log('  首次启动，已生成账号，请立即记录并修改：');
  console.log(`  用户名: admin`);
  console.log(`  密  码: ${pass}`);
  console.log(`  （保存在 ${CONFIG_FILE}，也可改用环境变量 AUTH_USER / AUTH_PASS）`);
  console.log('==============================================');
  return c;
}
const CREDS = loadCredentials();

/* ---------- 条目存储 ---------- */
function readItems() {
  try {
    const arr = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
    if (Array.isArray(arr)) return arr;
  } catch { /* 首次运行 */ }
  const now = Date.now();
  const seed = [{
    id: 'welcome', type: 'note', title: '欢迎使用 Snippet Hub',
    content: '这是你的私有部署实例，数据保存在服务器的 data/items.json。\n\n1. 点击卡片右下角 ⧉ 一键复制全文\n2. 星标 = 常用，排在最前\n3. ⌘K 或 / 快速搜索\n4. 左下角可导出 JSON 备份\n5. 服务器上建议配合 HTTPS 反向代理使用',
    tags: ['说明'], fav: false, createdAt: now, updatedAt: now,
  }];
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(seed, null, 2));
  return seed;
}
function writeItems(arr) {
  const tmp = ITEMS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, ITEMS_FILE);
}
if (!fs.existsSync(ITEMS_FILE)) writeItems(readItems());

/* ---------- 会话 ---------- */
const sessions = new Map(); // token -> expires
const loginAttempts = new Map(); // ip -> [timestamps]

function createSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}
function validSession(token) {
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function rateLimited(ip) {
  const now = Date.now();
  const arr = (loginAttempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  loginAttempts.set(ip, arr);
  return arr.length >= 10;
}
function recordLoginFail(ip) {
  const arr = loginAttempts.get(ip) || [];
  arr.push(Date.now());
  loginAttempts.set(ip, arr);
}

/* ---------- HTTP 工具 ---------- */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res, urlPath) {
  let p = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA 兜底
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(b2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------- 服务器 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const api = u.pathname.startsWith('/api/');
  const ip = req.socket.remoteAddress || '?';

  try {
    /* --- 登录 / 登出 --- */
    if (u.pathname === '/api/login' && req.method === 'POST') {
      if (rateLimited(ip)) return json(res, 429, { error: '尝试过于频繁，请 10 分钟后再试' });
      const body = JSON.parse((await readBody(req)) || '{}');
      if (safeEqual(body.user, CREDS.user) && safeEqual(body.pass, CREDS.pass)) {
        res.setHeader('Set-Cookie',
          `${SESSION_COOKIE}=${createSession()}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
        return json(res, 200, { ok: true });
      }
      recordLoginFail(ip);
      return json(res, 401, { error: '用户名或密码错误' });
    }
    if (u.pathname === '/api/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) sessions.delete(token);
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
      return json(res, 200, { ok: true });
    }

    /* --- 鉴权 --- */
    const authed = validSession(parseCookies(req)[SESSION_COOKIE]);
    if (api && !authed) return json(res, 401, { error: '未登录' });

    if (u.pathname === '/api/me' && req.method === 'GET') {
      return json(res, 200, { user: CREDS.user, authed });
    }

    /* --- 条目 API --- */
    if (u.pathname === '/api/items' && req.method === 'GET') {
      return json(res, 200, readItems());
    }
    if (u.pathname === '/api/items' && req.method === 'PUT') {
      const body = JSON.parse((await readBody(req)) || 'null');
      if (!Array.isArray(body)) return json(res, 400, { error: '格式错误' });
      const clean = body.filter(it => it && typeof it === 'object' && typeof it.id === 'string');
      writeItems(clean);
      return json(res, 200, { ok: true, count: clean.length });
    }

    if (api) return json(res, 404, { error: 'not found' });
    if (!authed) {
      // 未登录访问页面时也返回首页，由前端跳登录视图
      return serveStatic(req, res, '/');
    }
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    return json(res, 500, { error: '服务器错误', detail: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`Snippet Hub 已启动 → http://localhost:${PORT}（数据目录：${DATA_DIR}）`);
});
